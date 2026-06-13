/**
 * Renter status page server actions — verify a `booking_status` magic-link and
 * load / cancel the booking it names (Phase 3).
 *
 * Security model (mirrors apps/web's RSVP actions): the signed token IS the
 * authorization. We verify its signature + expiry, then read/write ONLY the
 * booking named in the verified claim, scoping by BOTH booking_id AND church_id
 * from inside the claim — never the URL. The service-role client bypasses RLS,
 * so this claim-scoping is the access control. Cancel is allowed only while the
 * booking is still pending (a renter can withdraw a request, not undo an
 * approved hold). All writes go through the SECURITY DEFINER cancel RPC.
 */
"use server";

import { appBaseUrl, verifyBookingStatusToken, type BookingTokenError } from "@/lib/booking-link";
import {
  acceptRentalAgreement,
  cancelBooking,
  getBookingById,
  getChurchName,
  getRentalAgreement,
  listBookingResources,
  listResources,
  setPaymentStatus,
} from "@/lib/data/booking";
import { createPaymentProvider } from "@/lib/payments";
import type { RentalSnapshot } from "@/lib/rental-agreement";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/messages";
import type { BookingStatus, PaymentStatus } from "@/src/types/booking";

export type LoadError = BookingTokenError | "not_found";

export interface RenterContext {
  booking_id: string;
  status: BookingStatus;
  title: string;
  starts_at_utc: string;
  ends_at_utc: string;
  facility_name: string;
  church_name: string;
  terms: string | null;
  /** Only pending requests can be cancelled by the renter. */
  cancellable: boolean;
  locale: Locale;
  /** Rental monetization (Phase 5). */
  payment_status: PaymentStatus;
  /** The frozen agreement HTML, if one was captured. */
  agreement_html: string | null;
  /** True once the renter has e-accepted the agreement. */
  agreement_accepted: boolean;
  /** True when a deposit is owed (priced + not yet paid). */
  deposit_pending: boolean;
}

export type LoadResult =
  | { ok: true; context: RenterContext }
  | { ok: false; error: LoadError };

export async function loadRenterContext(token: string): Promise<LoadResult> {
  const v = await verifyBookingStatusToken(token);
  if (!v.ok) return { ok: false, error: v.error };

  const booking = await getBookingById(v.bookingId);
  // Claim-scoped: the booking must exist AND belong to the claim's church.
  if (!booking || booking.church_id !== v.churchId) {
    return { ok: false, error: "not_found" };
  }

  const [churchName, resources, brMap, agreement] = await Promise.all([
    getChurchName(v.churchId),
    listResources(v.churchId),
    listBookingResources([booking.id]),
    getRentalAgreement(booking.id),
  ]);
  const primaryId = brMap[booking.id]?.[0];
  const facility = resources.find((r) => r.id === primaryId)?.name ?? booking.title;

  // Locale: fall back to the default (no church-member language for a renter).
  const locale: Locale = isLocale(DEFAULT_LOCALE) ? DEFAULT_LOCALE : "no";

  return {
    ok: true,
    context: {
      booking_id: booking.id,
      status: booking.status,
      title: booking.title,
      starts_at_utc: booking.starts_at_utc,
      ends_at_utc: booking.ends_at_utc,
      facility_name: facility,
      church_name: churchName,
      terms: null,
      cancellable: booking.status === "pending",
      locale,
      payment_status: booking.payment_status,
      agreement_html: agreement?.agreement_html ?? null,
      agreement_accepted: Boolean(agreement?.accepted_at),
      deposit_pending: booking.payment_status === "deposit_pending",
    },
  };
}

export type CancelResult =
  | { ok: true; status: BookingStatus }
  | { ok: false; error: LoadError | "not_cancellable" | "failed" };

/** Cancel the renter's own PENDING booking (idempotent-ish; re-cancel is a no-op). */
export async function cancelRenterBooking(token: string): Promise<CancelResult> {
  const v = await verifyBookingStatusToken(token);
  if (!v.ok) return { ok: false, error: v.error };

  const booking = await getBookingById(v.bookingId);
  if (!booking || booking.church_id !== v.churchId) {
    return { ok: false, error: "not_found" };
  }
  if (booking.status !== "pending") {
    return { ok: false, error: "not_cancellable" };
  }

  // actor = null-uuid sentinel isn't valid; the RPC takes p_actor uuid but the
  // renter has no auth user. Pass the church_id as a benign non-null marker is
  // wrong — instead the cancel RPC accepts any uuid for audit. Use the booking's
  // own id as the actor marker (audit shows a self-cancel by the renter token).
  const result = await cancelBooking(booking.id, booking.id);
  if (!result.ok) return { ok: false, error: "failed" };
  return { ok: true, status: result.status };
}

// ── Rental e-acceptance + deposit payment (Phase 5) ───────────────────────────

export type AcceptResult =
  | { ok: true; already: boolean }
  | { ok: false; error: LoadError | "failed" };

/**
 * Record the renter's cryptographic e-acceptance of the frozen agreement. The
 * status-token's jti (verified, never from the URL) is stored as the acceptance
 * marker — a simple token-bound signature standing in for a wet signature.
 * (Full BankID / qualified e-sign is a noted future upgrade.)
 */
export async function acceptAgreement(token: string): Promise<AcceptResult> {
  const v = await verifyBookingStatusToken(token);
  if (!v.ok) return { ok: false, error: v.error };

  const booking = await getBookingById(v.bookingId);
  if (!booking || booking.church_id !== v.churchId) {
    return { ok: false, error: "not_found" };
  }
  const res = await acceptRentalAgreement({
    bookingId: booking.id,
    churchId: booking.church_id,
    tokenJti: v.jti,
  });
  if (!res.ok) return { ok: false, error: "failed" };
  return { ok: true, already: Boolean(res.already) };
}

export type PayResult =
  | { ok: true; redirectUrl: string; usedStub: boolean }
  | { ok: false; error: LoadError | "no_deposit" | "failed" };

/**
 * Start (or resume) the deposit payment via the Vipps seam. Returns a redirect
 * URL the client sends the renter to. With no merchant creds the keyless stub
 * returns a fake URL pointing back at this page's stub callback, so the local
 * flow completes end-to-end. Re-derives the amount from the FROZEN snapshot.
 */
export async function payDeposit(token: string): Promise<PayResult> {
  const v = await verifyBookingStatusToken(token);
  if (!v.ok) return { ok: false, error: v.error };

  const booking = await getBookingById(v.bookingId);
  if (!booking || booking.church_id !== v.churchId) {
    return { ok: false, error: "not_found" };
  }

  const agreement = await getRentalAgreement(booking.id);
  const snap = (agreement?.snapshot ?? {}) as Partial<RentalSnapshot>;
  const price = snap.price_nok ?? 0;
  const pct = snap.deposit_pct ?? 0;
  const depositNok = Math.round((price ?? 0) * ((pct ?? 0) / 100) * 100) / 100;
  if (depositNok <= 0) return { ok: false, error: "no_deposit" };

  const provider = createPaymentProvider(process.env as Record<string, string | undefined>);
  const origin = appBaseUrl().replace(/\/+$/, "");
  const intent = await provider.createPayment({
    amountNok: depositNok,
    reference: `booking:${booking.id}:deposit`,
    returnUrl: `${origin}/r/${encodeURIComponent(token)}`,
    description: `Depositum ${booking.title}`,
  });
  if (!intent.ok) return { ok: false, error: "failed" };
  return { ok: true, redirectUrl: intent.redirectUrl, usedStub: intent.provider === "stub" };
}

/**
 * Stub-safe deposit completion — invoked when the renter returns to this page
 * with `?stub=1` from the StubVippsProvider redirect. Flips deposit_pending →
 * deposit_paid. No-op (and safe) when there is nothing pending. With real Vipps
 * this is handled by the webhook callback instead; the stub uses this path so
 * the local flow needs no inbound webhook.
 */
export async function completeStubDeposit(token: string): Promise<{ ok: boolean }> {
  const v = await verifyBookingStatusToken(token);
  if (!v.ok) return { ok: false };
  const booking = await getBookingById(v.bookingId);
  if (!booking || booking.church_id !== v.churchId) return { ok: false };
  if (booking.payment_status !== "deposit_pending") return { ok: true };
  await setPaymentStatus({
    bookingId: booking.id,
    churchId: booking.church_id,
    status: "deposit_paid",
    reference: booking.payment_reference,
  });
  return { ok: true };
}
