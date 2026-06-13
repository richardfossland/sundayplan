/**
 * SERVER-ONLY magic-link helpers for the no-account renter status path.
 *
 * Reuses `@sundayplan/auth`'s booking-status token family (HS256, same machinery
 * + secret as the volunteer RSVP links) — the signed token IS the authorization
 * for a renter to view + cancel THEIR pending booking. The secret comes from the
 * SAME env var the rest of SundayPlan uses (MAGICLINK_SECRET; see apps/web's
 * RSVP actions). Verification yields a trusted booking_id + church_id; nothing
 * from the URL is trusted except the token itself.
 */
import { signBookingStatus, verifyBookingStatus } from "@sundayplan/auth";

/** 30 days — a rental decision window plus a cancel-on-pending grace period. */
export const BOOKING_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export type BookingTokenError = "missing_secret" | "invalid" | "expired" | "wrong_purpose";

function getSecret(): string {
  const s = process.env.MAGICLINK_SECRET;
  if (!s) throw new Error("MAGICLINK_SECRET is not set");
  return s;
}

export function hasMagicLinkSecret(): boolean {
  return Boolean(process.env.MAGICLINK_SECRET);
}

/** Mint a renter status token carrying the (verified) booking + church. */
export async function mintBookingStatusToken(
  bookingId: string,
  churchId: string,
): Promise<string> {
  return signBookingStatus(
    { booking_id: bookingId, church_id: churchId, ttl_seconds: BOOKING_TOKEN_TTL_SECONDS },
    getSecret(),
  );
}

export type VerifiedBookingToken =
  | { ok: true; bookingId: string; churchId: string }
  | { ok: false; error: BookingTokenError };

/** Verify a renter status token; pure crypto, no DB. */
export async function verifyBookingStatusToken(
  token: string,
): Promise<VerifiedBookingToken> {
  if (!hasMagicLinkSecret()) return { ok: false, error: "missing_secret" };
  const res = await verifyBookingStatus(token, getSecret());
  if (!res.ok) {
    const error: BookingTokenError =
      res.reason === "expired"
        ? "expired"
        : res.reason === "wrong_purpose"
          ? "wrong_purpose"
          : "invalid";
    return { ok: false, error };
  }
  return { ok: true, bookingId: res.claims.booking_id, churchId: res.claims.church_id };
}

/** Absolute renter-status URL (`/r/<token>`), mirroring SundayPlan's RSVP route. */
export function buildStatusLink(baseUrl: string, token: string): string {
  const origin = baseUrl.replace(/\/+$/, "");
  return `${origin}/r/${encodeURIComponent(token)}`;
}

/** The app's public base URL for building absolute links in comms. */
export function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BOOKING_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://booking.sundaysuite.app"
  );
}

// ── ICS feed token (Phase 4) ──────────────────────────────────────────────────
// A stable, unguessable per-resource token for the read-only calendar feed of a
// NON-public resource (members/staff subscribe with the token URL). Derived as
// HMAC(secret, "ics:" + resourceId), so it needs no storage and is the same for
// every fetch (subscriptions are long-lived). Public resources need no token.

/** Compute the deterministic ICS feed token for a resource (hex, 32 chars). */
export async function icsFeedToken(resourceId: string): Promise<string> {
  const secret = getSecret();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`ics:${resourceId}`));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** Constant-time-ish check that `token` is the resource's ICS feed token. */
export async function verifyIcsFeedToken(
  resourceId: string,
  token: string,
): Promise<boolean> {
  if (!hasMagicLinkSecret() || !token) return false;
  const expected = await icsFeedToken(resourceId);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
