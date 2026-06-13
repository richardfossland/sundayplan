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
 * The reference is the authorization surface here: it embeds our own booking id
 * and is only known to us + Vipps. With real Vipps additionally configure the
 * webhook secret / signature verification (a noted future hardening — Vipps
 * signs callbacks with an HMAC the merchant registers). The stub never hits this
 * route (it completes via the return-page action), so the keyless gate stays
 * green without an inbound webhook.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  getBookingById,
  getRentalAgreement,
  setPaymentStatus,
} from "@/lib/data/booking";
import {
  createPaymentProvider,
  parseVippsState,
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

  // Determine the authoritative payment state. With real Vipps configured we
  // re-fetch the status from the provider (never trust the webhook body alone);
  // otherwise we map the body's state field directly (stub / test callers).
  let status = parseVippsState(
    typeof body.name === "string" ? body.name : (body.state as string | undefined),
  );
  if (paymentsConfigured(process.env as Record<string, string | undefined>)) {
    const provider = createPaymentProvider(process.env as Record<string, string | undefined>);
    const confirmed = await provider.getStatus(booking.payment_reference ?? ref.bookingId);
    if (confirmed.ok) status = confirmed.status;
  }

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
