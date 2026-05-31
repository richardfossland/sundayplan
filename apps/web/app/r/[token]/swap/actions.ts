/**
 * Volunteer swap / find-a-replacement (no account). Token purpose 'swap_request'
 * carries the assignment. We rank substitutes with the SDK brain
 * (`findReplacements`) and either propose a specific sub (auto-creates a pending
 * assignment + declines the original) or leave the slot open for the planner —
 * the GraceSquad/PC "find your replacement, or hand it back" flow.
 */
"use server";

import { revalidatePath } from "next/cache";
import type { RankedReplacement } from "@sundayplan/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifySelfServiceToken, type SelfServiceError } from "@/lib/data/volunteer-self-service";
import { findReplacements } from "@/lib/data/swap";

export interface SwapContext {
  assignment_id: string;
  church_id: string;
  service_id: string;
  role_id: string;
  member_id: string;
  volunteer_name: string;
  role_name: string;
  service_title: string;
  service_starts_at: string;
  candidates: { member_id: string; name: string; score: number; warnings: string[] }[];
}

export type SwapLoad = { ok: true; ctx: SwapContext } | { ok: false; error: SelfServiceError | "not_found" };

interface AssignmentRow {
  id: string;
  church_id: string;
  service_id: string;
  role_id: string;
  member_id: string;
  member: { display_name: string } | null;
  role: { name: string } | null;
  service: { name: string; starts_at_utc: string } | null;
}

export async function loadSwapContext(token: string): Promise<SwapLoad> {
  const v = await verifySelfServiceToken(token, "swap_request");
  if (!v.ok) return v;
  if (!v.claims.assignment_id) return { ok: false, error: "not_found" };

  const admin = createAdminClient();
  const { data } = await admin
    .from("assignment")
    .select("id, church_id, service_id, role_id, member_id, member:member_id(display_name), role:role_id(name), service:service_id(name, starts_at_utc)")
    .eq("id", v.claims.assignment_id)
    .eq("member_id", v.claims.member_id)
    .maybeSingle();
  if (!data) return { ok: false, error: "not_found" };
  const a = data as unknown as AssignmentRow;

  const ranked: RankedReplacement[] = await findReplacements(admin, {
    id: a.id,
    church_id: a.church_id,
    service_id: a.service_id,
    role_id: a.role_id,
    member_id: a.member_id,
  });

  // Resolve names for the ranked member ids.
  const ids = ranked.map((r) => r.member_id);
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: people } = await admin.from("member").select("id, display_name").in("id", ids);
    for (const p of (people ?? []) as { id: string; display_name: string }[]) nameById.set(p.id, p.display_name);
  }

  return {
    ok: true,
    ctx: {
      assignment_id: a.id,
      church_id: a.church_id,
      service_id: a.service_id,
      role_id: a.role_id,
      member_id: a.member_id,
      volunteer_name: a.member?.display_name ?? "there",
      role_name: a.role?.name ?? "your role",
      service_title: a.service?.name ?? "the service",
      service_starts_at: a.service?.starts_at_utc ?? "",
      candidates: ranked.map((r) => ({
        member_id: r.member_id,
        name: nameById.get(r.member_id) ?? r.member_id,
        score: Math.round(r.score),
        warnings: r.warnings.map((w) => w.message),
      })),
    },
  };
}

export type SwapResult = { ok: boolean; error?: string };

/** Propose a specific replacement: pending assignment for the sub + decline original + resolve swap. */
export async function proposeReplacement(token: string, replacementMemberId: string): Promise<SwapResult> {
  const v = await verifySelfServiceToken(token, "swap_request");
  if (!v.ok || !v.claims.assignment_id) return { ok: false, error: "invalid" };
  const admin = createAdminClient();

  const { data: orig } = await admin
    .from("assignment")
    .select("id, church_id, service_id, role_id, member_id")
    .eq("id", v.claims.assignment_id)
    .eq("member_id", v.claims.member_id)
    .maybeSingle();
  if (!orig) return { ok: false, error: "not_found" };
  const a = orig as { church_id: string; service_id: string; role_id: string; member_id: string };

  // Add the replacement as a pending proposal (planner-style natural-key upsert).
  const { error: insErr } = await admin.from("assignment").upsert(
    {
      church_id: a.church_id,
      service_id: a.service_id,
      role_id: a.role_id,
      member_id: replacementMemberId,
      status: "pending",
      created_by: "swap",
    },
    { onConflict: "service_id,role_id,member_id" },
  );
  if (insErr) return { ok: false, error: insErr.message };

  // Decline the original and record the resolved swap.
  await admin
    .from("assignment")
    .update({ status: "declined", responded_at: new Date().toISOString() })
    .eq("id", v.claims.assignment_id);
  await admin.from("swap_request").insert({
    church_id: a.church_id,
    assignment_id: v.claims.assignment_id,
    requested_by_member_id: a.member_id,
    status: "resolved",
    claimed_by_member_id: replacementMemberId,
    resolved_at: new Date().toISOString(),
  });

  revalidatePath("/schedule");
  return { ok: true };
}

/** Hand the slot back to the planner: decline + open swap request. */
export async function leaveOpen(token: string, note?: string): Promise<SwapResult> {
  const v = await verifySelfServiceToken(token, "swap_request");
  if (!v.ok || !v.claims.assignment_id) return { ok: false, error: "invalid" };
  const admin = createAdminClient();

  const { data: orig } = await admin
    .from("assignment")
    .select("church_id, member_id")
    .eq("id", v.claims.assignment_id)
    .eq("member_id", v.claims.member_id)
    .maybeSingle();
  if (!orig) return { ok: false, error: "not_found" };
  const a = orig as { church_id: string; member_id: string };

  await admin
    .from("assignment")
    .update({ status: "declined", responded_at: new Date().toISOString() })
    .eq("id", v.claims.assignment_id);
  await admin.from("swap_request").insert({
    church_id: a.church_id,
    assignment_id: v.claims.assignment_id,
    requested_by_member_id: a.member_id,
    status: "open",
    note: (note ?? "").trim().slice(0, 500) || null,
  });

  revalidatePath("/schedule");
  return { ok: true };
}
