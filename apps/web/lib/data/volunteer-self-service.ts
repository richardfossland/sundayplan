/**
 * Volunteer self-service links — blockout/availability + swap, all no-account
 * (Doodle-simple). Same model as the RSVP loop: a signed magic-link token IS the
 * authorization (member_id + church_id from the verified claim), and writes go
 * through the service-role client scoped to that claim. Mirrors lib/data/magic-link.ts.
 *
 * SERVER-ONLY: imports the admin client and the signing secret.
 */
import { signMagicLink, verifyMagicLink, tokenHash } from "@sundayplan/auth";
import type { MagicLinkClaims, MagicLinkPurpose } from "@sundayplan/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { appBaseUrl } from "@/lib/data/magic-link";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — self-service is open-ended

function secret(): string {
  const s = process.env.MAGICLINK_SECRET;
  if (!s) throw new Error("MAGICLINK_SECRET is not set — required for volunteer self-service links.");
  return s;
}

/** Map a self-service purpose to its public page path under /r/<token>/…. */
function pathFor(purpose: MagicLinkPurpose): string {
  return purpose === "swap_request" ? "swap" : "availability";
}

export interface SelfServiceTarget {
  member_id: string;
  church_id: string;
  purpose: Extract<MagicLinkPurpose, "availability_set" | "swap_request">;
  assignment_id?: string;
}

/**
 * Mint one self-service link and record its hash (so it can expire / be audited).
 * Returns the absolute URL the volunteer taps.
 */
export async function mintSelfServiceLink(
  target: SelfServiceTarget,
  opts: { ttlSeconds?: number; baseUrl?: string } = {},
): Promise<{ token: string; url: string }> {
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const token = await signMagicLink(
    {
      member_id: target.member_id,
      church_id: target.church_id,
      purpose: target.purpose,
      assignment_id: target.assignment_id,
      ttl_seconds: ttl,
    },
    secret(),
  );

  const admin = createAdminClient();
  await admin.from("magic_link").insert({
    member_id: target.member_id,
    purpose: target.purpose,
    assignment_id: target.assignment_id ?? null,
    token_hash: await tokenHash(token),
    single_use: false,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
  });

  const base = opts.baseUrl ?? appBaseUrl();
  return { token, url: `${base}/r/${token}/${pathFor(target.purpose)}` };
}

export type SelfServiceError = "invalid" | "expired" | "wrong_purpose" | "missing_secret";

/** Verify a self-service token for the expected purpose; pure crypto, no DB. */
export async function verifySelfServiceToken(
  token: string,
  expected: MagicLinkPurpose,
): Promise<{ ok: true; claims: MagicLinkClaims } | { ok: false; error: SelfServiceError }> {
  if (!process.env.MAGICLINK_SECRET) return { ok: false, error: "missing_secret" };
  // During a secret rotation, also accept the previous secret (current first).
  const previous = process.env.MAGICLINK_SECRET_PREVIOUS;
  const res = await verifyMagicLink(token, previous ? [secret(), previous] : secret());
  if (!res.ok) return { ok: false, error: res.reason === "expired" ? "expired" : "invalid" };
  if (res.claims.purpose !== expected) return { ok: false, error: "wrong_purpose" };
  return { ok: true, claims: res.claims };
}
