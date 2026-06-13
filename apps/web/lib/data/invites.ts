/**
 * Church-invite minting + redemption (Phase 1.3) — server-only.
 *
 * A planner mints a signed, expiring invite link tied to their church + a role,
 * then copy-pastes it to a co-planner (no email/SMS provider needed). The link
 * lands on `/r/<token>/join`, where — once the recipient has a Supabase account —
 * we create the `church_member` row with the invited role.
 *
 * We reuse `@sundayplan/auth` (`signChurchInvite`/`verifyChurchInvite`) so we add
 * no new crypto, and persist a `magic_link` row (token_hash, never the raw token)
 * via the service-role admin client so redemption can enforce single-use/expiry —
 * exactly like the volunteer RSVP links, but church+role scoped instead of
 * member scoped.
 *
 * SERVER-ONLY: imports the service-role admin client + the signing secret. Only
 * ever import from server code (server actions / RSC / route handlers).
 */
import {
  signChurchInvite,
  verifyChurchInvite,
  buildInviteLink,
  tokenHash,
} from "@sundayplan/auth";
import type { ChurchInviteRole } from "@sundayplan/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { appBaseUrl } from "@/lib/data/magic-link";

/** Default invite lifetime: 14 days — an onboarding window, not forever. */
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 14;

/** The signing secret. Server-only; never reaches the browser. */
function magicLinkSecret(): string {
  const secret = process.env.MAGICLINK_SECRET;
  if (!secret) {
    throw new Error(
      "MAGICLINK_SECRET is not set — required to mint church invite links.",
    );
  }
  return secret;
}

export interface MintedInvite {
  /** The absolute link a planner copy-pastes. */
  invite_link: string;
  role: ChurchInviteRole;
  /** ISO timestamp when the link stops working. */
  expires_at: string;
}

/**
 * Mint one church-invite link for a church + role and record its hash. Invite
 * links are single-use by default: redeeming creates exactly one membership.
 * Returns the absolute URL the planner pastes into chat/email themselves.
 */
export async function mintChurchInvite(
  churchId: string,
  role: ChurchInviteRole,
  opts: { ttlSeconds?: number; baseUrl?: string } = {},
): Promise<MintedInvite> {
  const secret = magicLinkSecret();
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const baseUrl = opts.baseUrl ?? appBaseUrl();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const token = await signChurchInvite(
    { church_id: churchId, role, ttl_seconds: ttl },
    secret,
  );

  const admin = createAdminClient();
  const { error } = await admin.from("magic_link").insert({
    purpose: "church_invite",
    church_id: churchId,
    invite_role: role,
    token_hash: await tokenHash(token),
    single_use: true,
    expires_at: expiresAt,
  });
  if (error) throw error;

  return { invite_link: buildInviteLink(baseUrl, token), role, expires_at: expiresAt };
}

export type InviteLoadError =
  | "invalid"
  | "expired"
  | "wrong_purpose"
  | "not_found"
  | "spent"
  | "missing_secret";

export interface InviteContext {
  church_id: string;
  church_name: string;
  role: ChurchInviteRole;
  /** Inviting church's locale (`no`/`en`/…), used to render the accept page. */
  locale: string;
}

export type InviteLoadResult =
  | { ok: true; context: InviteContext }
  | { ok: false; error: InviteLoadError };

/** SHA-256 hex of the token; service-role lookup helper. */
async function inviteRow(token: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("magic_link")
    .select("id, church_id, invite_role, single_use, used_at, purpose")
    .eq("token_hash", await tokenHash(token))
    .maybeSingle();
  return data as
    | {
        id: string;
        church_id: string | null;
        invite_role: ChurchInviteRole | null;
        single_use: boolean;
        used_at: string | null;
        purpose: string;
      }
    | null;
}

/**
 * Verify + load an invite for the accept page. Verifies signature + expiry +
 * purpose (pure crypto), then confirms a matching, unspent `magic_link` row
 * exists and reads the church name. The role is taken from the verified claim;
 * the DB row is the single-use ledger.
 */
export async function loadInviteContext(token: string): Promise<InviteLoadResult> {
  if (!process.env.MAGICLINK_SECRET) return { ok: false, error: "missing_secret" };

  // During a secret rotation, also accept the previous secret (current first).
  const previous = process.env.MAGICLINK_SECRET_PREVIOUS;
  const res = await verifyChurchInvite(token, previous ? [magicLinkSecret(), previous] : magicLinkSecret());
  if (!res.ok) {
    if (res.reason === "expired") return { ok: false, error: "expired" };
    if (res.reason === "wrong_purpose") return { ok: false, error: "wrong_purpose" };
    return { ok: false, error: "invalid" };
  }
  const { claims } = res;

  const row = await inviteRow(token);
  if (!row || row.purpose !== "church_invite") return { ok: false, error: "not_found" };
  // A spent single-use invite has already created its membership.
  if (row.single_use && row.used_at) return { ok: false, error: "spent" };

  const admin = createAdminClient();
  const { data: church } = await admin
    .from("church")
    .select("name, locale")
    .eq("id", claims.church_id)
    .maybeSingle();
  if (!church) return { ok: false, error: "not_found" };

  const churchRow = church as { name: string; locale: string | null };
  return {
    ok: true,
    context: {
      church_id: claims.church_id,
      church_name: churchRow.name,
      role: claims.role,
      locale: churchRow.locale ?? "no",
    },
  };
}

export type RedeemOutcome =
  | { ok: true; outcome: "joined" | "already_member"; church_id: string }
  | { ok: false; error: InviteLoadError | "not_signed_in" };

/**
 * Redeem an invite for the currently signed-in user: create their `church_member`
 * row with the invited role and mark the link spent. Idempotent — re-running for
 * a user who's already in the church reports `already_member` without churning
 * the role. Requires a Supabase session (the recipient must sign in / up first);
 * the accept page sends them to auth and bounces back here.
 */
export async function redeemChurchInvite(token: string): Promise<RedeemOutcome> {
  const loaded = await loadInviteContext(token);
  if (!loaded.ok) return loaded;
  const { church_id, role } = loaded.context;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_signed_in" };

  const admin = createAdminClient();

  // Already a member? Don't change their existing role or re-spend the link.
  const { data: existing } = await admin
    .from("church_member")
    .select("role")
    .eq("church_id", church_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) return { ok: true, outcome: "already_member", church_id };

  // church_member has no client INSERT policy — this is a service-role write
  // gated by the verified invite + the authenticated user above.
  const { error: memberErr } = await admin
    .from("church_member")
    .insert({ church_id, user_id: user.id, role });
  if (memberErr) return { ok: false, error: "invalid" };

  // Spend the single-use link (no-op for a reusable one or an already-used one).
  await admin
    .from("magic_link")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", await tokenHash(token))
    .eq("single_use", true)
    .is("used_at", null);

  return { ok: true, outcome: "joined", church_id };
}
