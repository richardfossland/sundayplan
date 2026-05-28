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

import type { MagicLinkClaims, MagicLinkPurpose } from "@sundayplan/shared";

const HEADER = { alg: "HS256", typ: "JWT" } as const;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

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
  secret: string,
  now?: number,
): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [header, body, sig] = parts;
  const signingInput = `${header}.${body}`;

  let signatureValid: boolean;
  try {
    const key = await hmacKey(secret);
    signatureValid = await crypto.subtle.verify("HMAC", key, fromB64url(sig), textEncoder.encode(signingInput));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!signatureValid) return { ok: false, reason: "bad_signature" };

  let claims: MagicLinkClaims;
  try {
    claims = JSON.parse(textDecoder.decode(fromB64url(body))) as MagicLinkClaims;
  } catch {
    return { ok: false, reason: "malformed" };
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
