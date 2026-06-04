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

import { createClient } from "@/lib/supabase/server";
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
