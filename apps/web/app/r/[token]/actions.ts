/**
 * Volunteer magic-link RSVP — verification + state transition (Phase 7).
 *
 * Why a server action / route handler and NOT an Edge Function: the repo has no
 * deployed respond Edge Function (apps/functions only holds `health`), and every
 * mutating path in this app is a Next.js server action validated with shared
 * schemas. We follow that pattern. The token verification reuses
 * `@sundayplan/auth` (the SAME module a Deno Edge Function would use), so moving
 * this to an Edge Function later is a lift-and-shift, not a rewrite.
 *
 * Security model: the signed magic-link token IS the authorization. We verify
 * its signature + expiry, then read/write ONLY the assignment named in the
 * verified claim, using the service-role client (which bypasses RLS) — mirroring
 * how onboarding uses the admin client for no-RLS-path operations. We never
 * trust anything from the URL except the token itself; member_id, church_id and
 * assignment_id all come from inside the verified claim. The `0003`/`0006`
 * volunteer RLS policies remain the documented contract for a future
 * Supabase-JWT (mobile) path.
 */
"use server";

import { revalidatePath } from "next/cache";
import {
  verifyMagicLink,
  applyResponse,
  parseAction,
  isRespondable,
  tokenHash,
  type RsvpAction,
} from "@sundayplan/auth";
import type { AssignmentStatus, MagicLinkClaims } from "@sundayplan/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { isLocale, DEFAULT_LOCALE, type Locale } from "@/lib/i18n/messages";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * A strict single-use link is spent once it has been used. Reusable links
 * (single_use = false, the default) never count as spent — change-of-mind stays
 * open until expiry. Links with no recorded row (mint insert failed, or a
 * preview token) are never treated as spent: the signature alone authorizes.
 */
async function isLinkSpent(admin: AdminClient, token: string): Promise<boolean> {
  const { data } = await admin
    .from("magic_link")
    .select("single_use, used_at")
    .eq("token_hash", await tokenHash(token))
    .maybeSingle();
  return Boolean(data?.single_use && data.used_at);
}

function secret(): string {
  const s = process.env.MAGICLINK_SECRET;
  if (!s) throw new Error("MAGICLINK_SECRET is not set");
  return s;
}

export type LoadError = "invalid" | "expired" | "wrong_purpose" | "not_found" | "missing_secret";

export interface AssignmentContext {
  assignment_id: string;
  status: AssignmentStatus;
  response_note: string | null;
  responded_at: string | null;
  volunteer_name: string;
  role_name: string;
  team_name: string | null;
  service_title: string;
  service_starts_at: string;
  church_name: string;
  respondable: boolean;
  locale: Locale;
}

export type LoadResult =
  | { ok: true; context: AssignmentContext }
  | { ok: false; error: LoadError };

/** Verify a token's claims; pure crypto, no DB. */
async function verify(
  token: string,
): Promise<{ ok: true; claims: MagicLinkClaims } | { ok: false; error: LoadError }> {
  if (!process.env.MAGICLINK_SECRET) return { ok: false, error: "missing_secret" };
  const res = await verifyMagicLink(token, secret());
  if (!res.ok) {
    return { ok: false, error: res.reason === "expired" ? "expired" : "invalid" };
  }
  if (res.claims.purpose !== "assignment_response" || !res.claims.assignment_id) {
    return { ok: false, error: "wrong_purpose" };
  }
  return { ok: true, claims: res.claims };
}

/**
 * Load the assignment context behind a token for the public response page.
 * Reads only the assignment named in the verified claim (+ its joins).
 */
export async function loadResponseContext(token: string): Promise<LoadResult> {
  const v = await verify(token);
  if (!v.ok) return v;
  const { claims } = v;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("assignment")
    .select(
      "id, member_id, church_id, status, response_note, responded_at, " +
        "member:member_id(display_name, language), " +
        "role:role_id(name, team:team_id(name)), " +
        "service:service_id(name, starts_at_utc), " +
        "church:church_id(name)",
    )
    .eq("id", claims.assignment_id)
    .eq("member_id", claims.member_id) // claim-scoped: token's member must own it
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, error: "not_found" };

  const spent = await isLinkSpent(admin, token);

  const row = data as unknown as Record<string, unknown>;
  const member = row.member as Record<string, unknown> | null;
  const role = row.role as Record<string, unknown> | null;
  const team = role?.team as Record<string, unknown> | null;
  const service = row.service as Record<string, unknown> | null;
  const church = row.church as Record<string, unknown> | null;
  const status = row.status as AssignmentStatus;
  const memberLang = member?.language as string | undefined;
  const locale: Locale = isLocale(memberLang) ? memberLang : DEFAULT_LOCALE;

  return {
    ok: true,
    context: {
      assignment_id: row.id as string,
      status,
      response_note: (row.response_note as string | null) ?? null,
      responded_at: (row.responded_at as string | null) ?? null,
      volunteer_name: (member?.display_name as string | undefined) ?? "there",
      role_name: (role?.name as string | undefined) ?? "your role",
      team_name: (team?.name as string | undefined) ?? null,
      service_title: (service?.name as string | undefined) ?? "the service",
      service_starts_at: (service?.starts_at_utc as string | undefined) ?? "",
      church_name: (church?.name as string | undefined) ?? "your church",
      // A spent single-use link is no longer respondable — show the closed state.
      respondable: isRespondable(status) && !spent,
      locale,
    },
  };
}

export type RespondOutcome =
  | { ok: true; outcome: "accepted" | "declined" | "unchanged" | "closed"; status: AssignmentStatus }
  | { ok: false; error: LoadError };

/**
 * Apply an accept/decline (+ optional note). Idempotent and change-of-mind
 * aware via the pure `applyResponse` state machine. Safe to call repeatedly.
 */
export async function respond(
  token: string,
  rawAction: string,
  note?: string,
): Promise<RespondOutcome> {
  const action = parseAction(rawAction);
  if (!action) return { ok: false, error: "invalid" };

  const v = await verify(token);
  if (!v.ok) return v;
  const { claims } = v;

  const admin = createAdminClient();

  // A strict single-use link that has already been used is closed.
  if (await isLinkSpent(admin, token)) {
    const { data: cur } = await admin
      .from("assignment")
      .select("status")
      .eq("id", claims.assignment_id)
      .eq("member_id", claims.member_id)
      .maybeSingle();
    return {
      ok: true,
      outcome: "closed",
      status: (cur as { status: AssignmentStatus } | null)?.status ?? "no_response",
    };
  }

  // Load current status (claim-scoped) to drive the transition.
  const { data: current, error: readErr } = await admin
    .from("assignment")
    .select("id, status")
    .eq("id", claims.assignment_id)
    .eq("member_id", claims.member_id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!current) return { ok: false, error: "not_found" };

  const result = applyResponse(
    (current as { status: AssignmentStatus }).status,
    action,
  );

  if (result.outcome === "closed") {
    return { ok: true, outcome: "closed", status: result.next };
  }

  const trimmedNote = (note ?? "").trim();

  // Write the transition. Even on an idempotent re-tap we refresh the note if
  // the volunteer added/changed one, but skip the status churn.
  const patch: Record<string, unknown> = {
    responded_at: new Date().toISOString(),
  };
  if (result.changed) patch.status = result.next;
  if (trimmedNote !== "") patch.response_note = trimmedNote.slice(0, 500);

  const needsWrite = result.changed || trimmedNote !== "";
  if (needsWrite) {
    const { error: updErr } = await admin
      .from("assignment")
      .update(patch)
      .eq("id", claims.assignment_id)
      .eq("member_id", claims.member_id);
    if (updErr) throw updErr;

    // Reflect the change for planners viewing the schedule / service detail.
    revalidatePath("/schedule");
    revalidatePath("/services");
  }

  // Consume a strict single-use link on a real accept/decline. The partial
  // filter (single_use = true, used_at is null) makes this a no-op for reusable
  // links and for re-taps, so it's safe to run unconditionally on a change.
  if (result.changed) {
    await admin
      .from("magic_link")
      .update({ used_at: new Date().toISOString() })
      .eq("token_hash", await tokenHash(token))
      .eq("single_use", true)
      .is("used_at", null);
  }

  return { ok: true, outcome: result.outcome, status: result.next };
}

export type { RsvpAction };
