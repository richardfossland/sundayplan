/**
 * Magic-link tokens — the volunteer auth path. A planner issues a token for a
 * member; the member taps the SMS/email link and can RSVP without an account.
 *
 * This is a compact HS256 JWT signed with a dedicated server secret (NOT the
 * Supabase JWT secret — keep them separate so a leak of one doesn't grant the
 * other). SERVER-ONLY: signing must never run in client code, which is why this
 * lives in @sundayplan/auth rather than the client SDK.
 *
 * Implemented on Web Crypto (HMAC-SHA256) so the exact same module runs in both
 * Deno Edge Functions (issuance/verification) and Node (these tests).
 *
 * Single-use / replay protection is enforced at the data layer, not here: every
 * token carries a `jti` that the Edge Function records in `magic_link` and marks
 * `used_at` on first use. This module owns signing, expiry, and tamper-checking.
 */

import type {
  ChurchInviteClaims,
  ChurchInviteRole,
  MagicLinkClaims,
  MagicLinkPurpose,
} from "@sundayplan/shared";

const HEADER = { alg: "HS256", typ: "JWT" } as const;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * A verification secret, or — for zero-downtime rotation — an ordered list of
 * secrets to try (current first, then previous). Signing always uses a single
 * secret; verification accepts the set so a token signed with a now-retired
 * secret still validates until it expires. Standard overlapping-key rotation:
 * issue with the new secret, keep the old one in the verify set until every
 * outstanding token's TTL has lapsed, then drop it. Callers wire this from
 * `MAGICLINK_SECRET` (+ optional `MAGICLINK_SECRET_PREVIOUS`).
 */
export type SecretOrSecrets = string | readonly string[];

export interface IssueOptions {
  member_id: string;
  church_id: string;
  purpose: MagicLinkPurpose;
  assignment_id?: string;
  /** Token lifetime in seconds (e.g. 7 days = 604800). */
  ttl_seconds: number;
  /** Override the issue time (unix seconds) — for tests/determinism. */
  now?: number;
  /** Override the nonce — defaults to a random UUID. */
  jti?: string;
}

export type VerifyResult =
  | { ok: true; claims: MagicLinkClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_purpose" };

export async function signMagicLink(opts: IssueOptions, secret: string): Promise<string> {
  const iat = opts.now ?? nowSeconds();
  const claims: MagicLinkClaims = {
    sub: opts.member_id,
    member_id: opts.member_id,
    church_id: opts.church_id,
    purpose: opts.purpose,
    ...(opts.assignment_id ? { assignment_id: opts.assignment_id } : {}),
    iat,
    exp: iat + opts.ttl_seconds,
    jti: opts.jti ?? crypto.randomUUID(),
  };
  const signingInput = `${b64urlString(JSON.stringify(HEADER))}.${b64urlString(JSON.stringify(claims))}`;
  const sig = await hmac(signingInput, secret);
  return `${signingInput}.${b64urlBytes(sig)}`;
}

export async function verifyMagicLink(
  token: string,
  secret: SecretOrSecrets,
  now?: number,
): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [header, body, sig] = parts;

  const sigCheck = await checkSignature(`${header}.${body}`, sig, secret);
  if (sigCheck !== "valid") return { ok: false, reason: sigCheck };

  let claims: MagicLinkClaims;
  try {
    claims = JSON.parse(textDecoder.decode(fromB64url(body))) as MagicLinkClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  // Reject a token from the *other* token family (e.g. a church-invite) before
  // returning a MagicLinkClaims, mirroring verifyChurchInvite's purpose guard.
  // Both families share the same secret + machinery, but an invite token carries
  // no member_id/sub; without this check verifyMagicLink would hand back claims
  // whose typed member_id/sub are actually undefined — a cross-token confusion
  // any caller that skips its own purpose re-check would silently inherit.
  if (claims.purpose === "church_invite" || !claims.member_id) {
    return { ok: false, reason: "wrong_purpose" };
  }
  if (typeof claims.exp !== "number" || claims.exp < (now ?? nowSeconds())) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, claims };
}

// ── Church invites (Phase 1.3) ───────────────────────────────────────────────
// A planner-facing variant of the magic link: it onboards a co-planner rather
// than authorizing a no-account volunteer. It is NOT member-scoped — the invitee
// has no `member` row; the token carries a church + the role to grant, and the
// accept page creates a `church_member` after the invitee has an account. Same
// HS256/secret/hashing machinery so single-use + expiry tracking is identical.

export interface InviteIssueOptions {
  church_id: string;
  role: ChurchInviteRole;
  /** Token lifetime in seconds (e.g. 14 days = 1209600). */
  ttl_seconds: number;
  /** Override the issue time (unix seconds) — for tests/determinism. */
  now?: number;
  /** Override the nonce — defaults to a random UUID. */
  jti?: string;
}

export type VerifyInviteResult =
  | { ok: true; claims: ChurchInviteClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_purpose" };

export async function signChurchInvite(
  opts: InviteIssueOptions,
  secret: string,
): Promise<string> {
  const iat = opts.now ?? nowSeconds();
  const claims: ChurchInviteClaims = {
    church_id: opts.church_id,
    role: opts.role,
    purpose: "church_invite",
    iat,
    exp: iat + opts.ttl_seconds,
    jti: opts.jti ?? crypto.randomUUID(),
  };
  const signingInput = `${b64urlString(JSON.stringify(HEADER))}.${b64urlString(JSON.stringify(claims))}`;
  const sig = await hmac(signingInput, secret);
  return `${signingInput}.${b64urlBytes(sig)}`;
}

export async function verifyChurchInvite(
  token: string,
  secret: SecretOrSecrets,
  now?: number,
): Promise<VerifyInviteResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [header, body, sig] = parts;

  const sigCheck = await checkSignature(`${header}.${body}`, sig, secret);
  if (sigCheck !== "valid") return { ok: false, reason: sigCheck };

  let claims: ChurchInviteClaims;
  try {
    claims = JSON.parse(textDecoder.decode(fromB64url(body))) as ChurchInviteClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  // Reject a token that isn't actually an invite (e.g. a volunteer RSVP token)
  // before trusting its church_id/role.
  if (claims.purpose !== "church_invite" || !claims.church_id || !claims.role) {
    return { ok: false, reason: "wrong_purpose" };
  }
  if (typeof claims.exp !== "number" || claims.exp < (now ?? nowSeconds())) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, claims };
}

/**
 * Absolute URL a planner copy-pastes to invite a co-planner. The token encodes
 * church + role, so the path carries only the token; the join page reads
 * everything trustworthy from inside the verified claim.
 */
export function buildInviteLink(baseUrl: string, token: string): string {
  const origin = baseUrl.replace(/\/+$/, "");
  return `${origin}/r/${encodeURIComponent(token)}/join`;
}

// ── Booking-status tokens (SundayBooking, no-account renters) ────────────────
// A third token family, modelled on the church-invite variant: it carries NO
// member_id (an external renter has no `member` row). It authorizes a renter to
// view + cancel the ONE pending booking named in the claim. Same HS256/secret/
// hashing machinery so single-use + expiry tracking is identical, but the claim
// is scoped to a booking_id + church_id rather than an assignment/member.

export interface BookingStatusClaims {
  booking_id: string;
  church_id: string;
  purpose: "booking_status";
  /** unix seconds */
  exp: number;
  /** unix seconds */
  iat: number;
  /** prevent reuse */
  jti: string;
}

export interface BookingStatusIssueOptions {
  booking_id: string;
  church_id: string;
  /** Token lifetime in seconds (e.g. 30 days = 2592000). */
  ttl_seconds: number;
  /** Override the issue time (unix seconds) — for tests/determinism. */
  now?: number;
  /** Override the nonce — defaults to a random UUID. */
  jti?: string;
}

export type VerifyBookingStatusResult =
  | { ok: true; claims: BookingStatusClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_purpose" };

export async function signBookingStatus(
  opts: BookingStatusIssueOptions,
  secret: string,
): Promise<string> {
  const iat = opts.now ?? nowSeconds();
  const claims: BookingStatusClaims = {
    booking_id: opts.booking_id,
    church_id: opts.church_id,
    purpose: "booking_status",
    iat,
    exp: iat + opts.ttl_seconds,
    jti: opts.jti ?? crypto.randomUUID(),
  };
  const signingInput = `${b64urlString(JSON.stringify(HEADER))}.${b64urlString(JSON.stringify(claims))}`;
  const sig = await hmac(signingInput, secret);
  return `${signingInput}.${b64urlBytes(sig)}`;
}

export async function verifyBookingStatus(
  token: string,
  secret: SecretOrSecrets,
  now?: number,
): Promise<VerifyBookingStatusResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [header, body, sig] = parts;

  const sigCheck = await checkSignature(`${header}.${body}`, sig, secret);
  if (sigCheck !== "valid") return { ok: false, reason: sigCheck };

  let claims: BookingStatusClaims;
  try {
    claims = JSON.parse(textDecoder.decode(fromB64url(body))) as BookingStatusClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  // Reject any other token family before trusting booking_id/church_id. A
  // member RSVP / invite token must never be usable on the renter-status path.
  if (claims.purpose !== "booking_status" || !claims.booking_id || !claims.church_id) {
    return { ok: false, reason: "wrong_purpose" };
  }
  if (typeof claims.exp !== "number" || claims.exp < (now ?? nowSeconds())) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, claims };
}

/**
 * SHA-256 hex of a token. The DB tracks single-use by `magic_link.token_hash`
 * (never the raw token), so issuance stores `tokenHash(token)` and the respond
 * path looks the row up by the same hash and flips `used_at`.
 */
export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── crypto + base64url helpers ───────────────────────────────────────────────

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Verify a token's HMAC signature against one OR MORE secrets (see
 * {@link SecretOrSecrets}). `"valid"` if ANY secret matches; `"bad_signature"`
 * if none do; `"malformed"` if the signature segment isn't decodable base64url.
 * Decoding happens once (secret-independent); only the cheap `verify` is retried
 * per secret. Mirrors the previous single-secret semantics exactly when given
 * one secret.
 */
async function checkSignature(
  signingInput: string,
  sig: string,
  secret: SecretOrSecrets,
): Promise<"valid" | "bad_signature" | "malformed"> {
  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = fromB64url(sig);
  } catch {
    return "malformed";
  }
  const secrets = typeof secret === "string" ? [secret] : secret;
  const input = textEncoder.encode(signingInput);
  for (const s of secrets) {
    try {
      const key = await hmacKey(s);
      if (await crypto.subtle.verify("HMAC", key, sigBytes, input)) return "valid";
    } catch {
      // A single unusable secret (e.g. an empty/misconfigured env value can't be
      // imported as an HMAC key) must not abort the rotation set — try the rest.
    }
  }
  return "bad_signature";
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmac(input: string, secret: string): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(input)));
}

function b64urlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlString(s: string): string {
  return b64urlBytes(textEncoder.encode(s));
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
