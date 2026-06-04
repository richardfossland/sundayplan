/**
 * Planner-side swap queue. The dashboard only shows a COUNT of open swaps; this
 * is where a planner actually works the queue — see who handed a slot back, and
 * pull the SDK-ranked shortlist of subs who can cover it without a new conflict
 * (the same `findReplacements` brain the volunteer self-service page uses).
 *
 * All reads run under the planner's RLS server client (church-scoped via the
 * `swap_planner_all` policy on swap_request and the standard tenant policies).
 */
"use server";

import { revalidatePath } from "next/cache";
import { decideAssignCandidate, decideCancelSwap, type SwapResolutionError } from "@sundayplan/sdk";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";
import { findReplacements, listOpenSwaps, type OpenSwap } from "@/lib/data/swap";

export type { OpenSwap };

export interface SwapCandidate {
  member_id: string;
  name: string;
  score: number;
  warnings: string[];
}

export type CandidatesResult =
  | { ok: true; candidates: SwapCandidate[] }
  | { ok: false; error: "not_found" };

/**
 * Rank substitutes for one open swap. Looks the swap up under RLS (so a planner
 * can only resolve their own church's rows), then runs the SDK ranking against
 * the vacated assignment and resolves the candidate names.
 */
export async function loadSwapCandidates(swapId: string): Promise<CandidatesResult> {
  const supabase = await createClient();

  const open = await listOpenSwaps(supabase);
  const swap = open.find((s) => s.id === swapId);
  if (!swap) return { ok: false, error: "not_found" };

  const ranked = await findReplacements(supabase, {
    id: swap.assignment_id,
    church_id: "", // RLS already scopes the read; church_id is unused by the ranker
    service_id: swap.service_id,
    role_id: swap.role_id,
    member_id: swap.vacated_member_id,
  });

  const ids = ranked.map((r) => r.member_id);
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await supabase.from("member").select("id, display_name").in("id", ids);
    for (const p of (data ?? []) as { id: string; display_name: string }[]) {
      nameById.set(p.id, p.display_name);
    }
  }

  return {
    ok: true,
    candidates: ranked.map((r) => ({
      member_id: r.member_id,
      name: nameById.get(r.member_id) ?? r.member_id,
      score: Math.round(r.score),
      warnings: r.warnings.map((w) => w.message),
    })),
  };
}

export type ResolveResult = { ok: true } | { ok: false; error: SwapResolutionError | "not_found" };

/**
 * Resolve an open swap by assigning the chosen candidate to the vacated slot.
 *
 * The pure gate (`decideAssignCandidate`, in the SDK) decides whether this is
 * legal — the swap must still be open, and the pick must be one of the currently
 * ranked, conflict-free candidates (re-ranked live here so a stale tab can't push
 * a now-ineligible member). The Supabase writes (assign + mark resolved) stay in
 * the action, under the planner's RLS server client. Both writes are scoped by
 * `swap_planner_all` / `assignment_planner_all`.
 *
 * Live-DB note: the two writes can't be wrapped in a single transaction from the
 * JS client, so we mark the swap resolved only after the assignment upsert
 * succeeds. The decision/validation seam is unit-tested offline; the write path
 * itself can only be exercised against a live Supabase.
 */
export async function assignCandidate(swapId: string, candidateId: string): Promise<ResolveResult> {
  const churchId = await getCurrentChurchId();
  if (!churchId) return { ok: false, error: "not_found" };
  const supabase = await createClient();

  // Re-read the swap + re-rank candidates under RLS at action time.
  const open = await listOpenSwaps(supabase);
  const swap = open.find((s) => s.id === swapId);
  if (!swap) return { ok: false, error: "not_found" }; // gone or no longer open

  const ranked = await findReplacements(supabase, {
    id: swap.assignment_id,
    church_id: churchId,
    service_id: swap.service_id,
    role_id: swap.role_id,
    member_id: swap.vacated_member_id,
  });

  const decision = decideAssignCandidate({
    status: swap.status,
    candidateId,
    requesterId: swap.vacated_member_id,
    eligibleMemberIds: ranked.map((r) => r.member_id),
  });
  if (!decision.ok) return decision;

  // Place the replacement on the vacated (service, role). Upsert on the natural
  // key flips a previously-removed member back to pending rather than tripping
  // the unique (service_id, role_id, member_id) — mirrors createAssignment.
  const { error: assignErr } = await supabase.from("assignment").upsert(
    {
      church_id: churchId,
      service_id: swap.service_id,
      role_id: swap.role_id,
      member_id: decision.memberId,
      status: "pending",
      created_by: "planner",
    },
    { onConflict: "service_id,role_id,member_id" },
  );
  if (assignErr) return { ok: false, error: "not_found" };

  // Mark the swap resolved (guarded on status=open so two planners racing can't
  // both resolve it — the second update no-ops at the row level).
  await supabase
    .from("swap_request")
    .update({ status: "resolved", claimed_by_member_id: decision.memberId, resolved_at: new Date().toISOString() })
    .eq("id", swapId)
    .eq("status", "open");

  revalidatePath("/swaps");
  return { ok: true };
}

/**
 * Cancel an open swap — the planner has handled it some other way (or it was a
 * mistake). The slot stays vacated; only the swap row closes. Pure gate in the
 * SDK; write under RLS, guarded on status=open.
 */
export async function cancelSwap(swapId: string): Promise<ResolveResult> {
  const supabase = await createClient();

  const open = await listOpenSwaps(supabase);
  const swap = open.find((s) => s.id === swapId);
  if (!swap) return { ok: false, error: "not_found" };

  const decision = decideCancelSwap(swap.status);
  if (!decision.ok) return decision;

  await supabase
    .from("swap_request")
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("id", swapId)
    .eq("status", "open");

  revalidatePath("/swaps");
  return { ok: true };
}
