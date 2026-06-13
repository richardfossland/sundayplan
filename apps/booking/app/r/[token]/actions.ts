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

import { verifyBookingStatusToken, type BookingTokenError } from "@/lib/booking-link";
import {
  cancelBooking,
  getBookingById,
  getChurchName,
  listBookingResources,
  listResources,
} from "@/lib/data/booking";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/messages";
import type { BookingStatus } from "@/src/types/booking";

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

  const [churchName, resources, brMap] = await Promise.all([
    getChurchName(v.churchId),
    listResources(v.churchId),
    listBookingResources([booking.id]),
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
