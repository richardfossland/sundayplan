/**
 * Magic-link minting for the volunteer RSVP loop (Phase 7) — server-only.
 *
 * One signed, expiring token per (member, assignment). The token is the whole
 * auth: it carries member_id + church_id + assignment_id, so the public response
 * page needs no planner session. We reuse `@sundayplan/auth` (`signMagicLink`)
 * rather than rolling new crypto, and persist a `magic_link` row (token_hash,
 * never the raw token) via the service-role client so the respond path can track
 * single-use / expiry.
 *
 * The output feeds the comms renderer's `accept_link` / `decline_link`
 * variables, closing the gap Phase 6 deliberately left open.
 *
 * SERVER-ONLY: this imports the service-role admin client and the signing
 * secret. Only ever import it from server code (server actions / RSC / route
 * handlers), never from a client component.
 */
import { signMagicLink, tokenHash, buildResponseLinks } from "@sundayplan/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** Default magic-link lifetime: 14 days (covers an invite + reminders window). */
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 14;

/** The signing secret. Server-only; never reaches the browser. */
function magicLinkSecret(): string {
  const secret = process.env.MAGICLINK_SECRET;
  if (!secret) {
    throw new Error(
      "MAGICLINK_SECRET is not set — required to mint volunteer response links.",
    );
  }
  return secret;
}

/** The public origin used to build absolute accept/decline URLs. */
export function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.VERCEL_URL?.replace(/^https?:\/\//, "").replace(/^/, "https://") ??
    "http://localhost:3000"
  );
}

export interface ResponseLinkTarget {
  member_id: string;
  church_id: string;
  assignment_id: string;
}

export interface MintedResponseLink {
  member_id: string;
  accept_link: string;
  decline_link: string;
  view_link: string;
}

/**
 * Mint one accept/decline link per target and record each token's hash in
 * `magic_link`. Tokens are minted in parallel; the `magic_link` rows are written
 * in a single insert. If the insert fails the links are still returned (the
 * tokens verify on their own signature) but single-use tracking won't apply —
 * callers that need strict single-use should surface the error.
 */
export async function mintResponseLinks(
  targets: ResponseLinkTarget[],
  opts: { ttlSeconds?: number; baseUrl?: string; singleUse?: boolean } = {},
): Promise<{ links: Record<string, MintedResponseLink>; rows: number }> {
  if (targets.length === 0) return { links: {}, rows: 0 };

  const secret = magicLinkSecret();
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const baseUrl = opts.baseUrl ?? appBaseUrl();
  // Opt-in: strict one-shot links. Default stays reusable so a volunteer can
  // change their mind until expiry (the Phase 7 contract); the respond path
  // enforces used_at only when single_use is true.
  const singleUse = opts.singleUse ?? false;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const links: Record<string, MintedResponseLink> = {};
  const magicLinkRows: Record<string, unknown>[] = [];

  await Promise.all(
    targets.map(async (t) => {
      const token = await signMagicLink(
        {
          member_id: t.member_id,
          church_id: t.church_id,
          purpose: "assignment_response",
          assignment_id: t.assignment_id,
          ttl_seconds: ttl,
        },
        secret,
      );
      const urls = buildResponseLinks(baseUrl, token);
      links[t.member_id] = { member_id: t.member_id, ...urls };
      magicLinkRows.push({
        member_id: t.member_id,
        purpose: "assignment_response",
        assignment_id: t.assignment_id,
        token_hash: await tokenHash(token),
        single_use: singleUse,
        expires_at: expiresAt,
      });
    }),
  );

  // Record the tokens (service-role; magic_link is RLS-locked to service role).
  const admin = createAdminClient();
  const { error, count } = await admin
    .from("magic_link")
    .insert(magicLinkRows, { count: "exact" });
  if (error) throw error;

  return { links, rows: count ?? magicLinkRows.length };
}
