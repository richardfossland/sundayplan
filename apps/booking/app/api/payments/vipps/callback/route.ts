/**
 * POST /api/payments/vipps/callback — Vipps ePayment webhook / callback.
 *
 * STUB-SAFE: with no merchant creds (the keyless default) there is no real Vipps
 * to call back, so this route exists primarily for the real-Vipps deploy. It
 * accepts a webhook body carrying `{ reference, name|state }`, resolves the
 * booking from the reference (`booking:<id>:deposit`), confirms with the
 * provider (`getStatus`) when configured, and flips booking.payment_status
 * accordingly via the SECURITY DEFINER RPC.
 *
 * SECURITY: the callback body is UNTRUSTED. The reference (`booking:<id>:deposit`)
 * is only a correlation handle, NOT proof of payment. So this route NEVER trusts
 * the body's state: with real Vipps configured it re-confirms via getStatus and
 * only flips on a provider-confirmed terminal state (failing closed if getStatus
 * can't confirm); without merchant creds it mutates nothing (the stub completes
 * via the return-page action tied to the booking's own reference, so no inbound
 * webhook is needed). A future hardening is to additionally verify the Vipps HMAC
 * webhook signature, but the getStatus re-confirmation is the load-bearing check.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  getBookingById,
  getRentalAgreement,
  setPaymentStatus,
} from "@/lib/data/booking";
import {
  createPaymentProvider,
  paymentStatusToBookingStatus,
  paymentsConfigured,
} from "@/lib/payments";

export const dynamic = "force-dynamic";

/** Parse `booking:<uuid>:deposit` → { bookingId, isDeposit }. */
function parseReference(reference: unknown): { bookingId: string; isDeposit: boolean } | null {
  if (typeof reference !== "string") return null;
  const m = reference.match(/^booking:([0-9a-f-]{36}):(deposit|full)$/i);
  if (!m) return null;
  return { bookingId: m[1], isDeposit: m[2].toLowerCase() === "deposit" };
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const ref = parseReference(body.reference);
  if (!ref) return NextResponse.json({ error: "bad_reference" }, { status: 400 });

  const booking = await getBookingById(ref.bookingId);
  if (!booking) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Determine the authoritative payment state. The webhook body is UNTRUSTED —
  // anyone who can guess `booking:<id>:deposit` could POST a forged "CAPTURED".
  //
  //   • Real Vipps configured: we IGNORE the body entirely and re-fetch the
  //     status from the provider (getStatus). Only a status the provider itself
  //     confirms is allowed to flip the booking. If getStatus fails (auth/network
  //     error), we do NOT fall back to the body — we reject, so a forged callback
  //     cannot upgrade payment_status when the real provider is unreachable.
  //   • No merchant creds (stub mode): there is no real Vipps to call back, so a
  //     legitimate inbound webhook never reaches this route (the stub completes
  //     via the return-page action tied to the booking's own reference). We
  //     therefore refuse to flip any status from an unauthenticated body here.
  const configured = paymentsConfigured(process.env as Record<string, string | undefined>);
  if (!configured) {
    // Stub mode: accept the ping (so a misconfigured test webhook 200s) but never
    // mutate payment state from the body alone.
    return NextResponse.json({ ok: true, ignored: "stub_mode" }, { status: 200 });
  }

  const provider = createPaymentProvider(process.env as Record<string, string | undefined>);
  const confirmed = await provider.getStatus(booking.payment_reference ?? ref.bookingId);
  if (!confirmed.ok) {
    // Could not confirm with Vipps → do not trust the callback body. 202 so Vipps
    // retries the webhook later rather than treating it as a permanent failure.
    return NextResponse.json({ ok: false, error: "unconfirmed" }, { status: 202 });
  }
  const status = confirmed.status;

  // Only act on a captured/refunded terminal state; ignore created/authorized
  // noise (the renter is still mid-flow).
  const next = paymentStatusToBookingStatus(status, ref.isDeposit);
  if (next === "deposit_paid" || next === "paid" || next === "refunded") {
    await setPaymentStatus({
      bookingId: booking.id,
      churchId: booking.church_id,
      status: next,
      reference: booking.payment_reference,
    });
    // Touch the agreement read so a 404 on a missing one never 500s the webhook.
    await getRentalAgreement(booking.id).catch(() => null);
  }

  return NextResponse.json({ ok: true, payment_status: next }, { status: 200 });
}
