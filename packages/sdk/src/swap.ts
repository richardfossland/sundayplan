/**
 * Swap / substitute finder — the brain behind "find your own replacement"
 * (GraceSquad/PC). When a volunteer can't make it, we rank the members who
 * *could* cover the slot without creating a new hard conflict, best first.
 *
 * Pure and deterministic: it composes the two existing engines —
 *   • `scoreCandidate`  ranks fit (skill, rotation, frequency, burnout, …) and
 *     hard-gates on availability (returns null → excluded).
 *   • `previewCandidate` checks the hypothetical assignment against the live
 *     schedule and reports any conflict it would introduce.
 * A candidate survives only if it scores AND introduces no *hard* conflict; any
 * remaining soft conflicts ride along as warnings for the planner/volunteer.
 */
import { scoreCandidate, type ScoringInputs } from "./scoring";
import { previewCandidate, type Conflict, type ConflictContext, type PlacedAssignment } from "./conflicts";
import type { ScoreBreakdown } from "@sundayplan/shared";

/** A potential substitute, with everything both engines need. */
export interface ReplacementCandidate {
  member_id: string;
  /** Hypothetical placement, conflict-checked against the current schedule. */
  placement: PlacedAssignment;
  /** Scoring inputs for ranking (same shape auto-fill builds). */
  scoring: ScoringInputs;
}

export interface RankedReplacement {
  member_id: string;
  score: number;
  breakdown: ScoreBreakdown;
  /** Soft conflicts that remain (none are hard — those are filtered out). */
  warnings: Conflict[];
}

export interface EligibleReplacementsInput {
  /**
   * Current schedule snapshot. It should already reflect the slot being vacated
   * (i.e. NOT include the declining member's placement), so a replacement isn't
   * judged against the very assignment they're replacing.
   */
  ctx: ConflictContext;
  candidates: ReplacementCandidate[];
  /** Members to skip — typically the declining member + anyone already placed. */
  excludeMemberIds?: string[];
}

/**
 * Rank eligible substitutes for a slot, best fit first. Excludes anyone
 * unavailable (score null) or who would create a hard conflict.
 */
export function eligibleReplacements(input: EligibleReplacementsInput): RankedReplacement[] {
  const exclude = new Set(input.excludeMemberIds ?? []);
  const out: RankedReplacement[] = [];

  for (const cand of input.candidates) {
    if (exclude.has(cand.member_id)) continue;

    const breakdown = scoreCandidate(cand.scoring);
    if (!breakdown) continue; // hard-gated (unavailable)

    const introduced = previewCandidate(input.ctx, cand.placement);
    if (introduced.some((c) => c.severity === "hard")) continue; // would break the schedule

    out.push({
      member_id: cand.member_id,
      score: breakdown.total,
      breakdown,
      warnings: introduced.filter((c) => c.severity === "soft"),
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * ── Resolution decision logic ────────────────────────────────────────────────
 *
 * The planner-side queue can RESOLVE an open swap by assigning one of the ranked
 * candidates to the vacated slot, or CANCEL the swap outright. The Supabase write
 * lives in the server action; the *decision* — "is this swap still actionable?"
 * and "may this candidate legitimately take the slot?" — is pure and lives here
 * so it's unit-testable without a DB.
 *
 * A swap is only resolvable while it's `open`. Once it's `claimed`, `resolved`,
 * or `cancelled`, a second planner (or a stale tab) must not be able to act on
 * it — that's the offline-checkable half of the optimistic-concurrency guard.
 */

/** The lifecycle states a swap_request row can be in (mirrors the DB check). */
export type SwapStatus = "open" | "claimed" | "cancelled" | "resolved";

/** Why an attempted assign/cancel can't proceed. */
export type SwapResolutionError =
  | "not_open" // the swap is no longer open (already resolved/cancelled/claimed)
  | "candidate_not_eligible" // the chosen member isn't in the ranked shortlist
  | "candidate_is_requester"; // can't assign the slot back to the person who left it

export type SwapResolutionDecision =
  | { ok: true; memberId: string }
  | { ok: false; error: SwapResolutionError };

export interface AssignCandidateInput {
  /** Current persisted status of the swap (read just before the write). */
  status: SwapStatus | string;
  /** The member the planner picked to cover the slot. */
  candidateId: string;
  /** The member who handed the slot back (cannot be reassigned to themselves). */
  requesterId: string;
  /** The currently-eligible candidate ids (from `eligibleReplacements`). */
  eligibleMemberIds: readonly string[];
}

/** Is this swap still in a state where a planner may act on it? */
export function isSwapResolvable(status: SwapStatus | string): boolean {
  return status === "open";
}

/**
 * Decide whether `candidateId` may be assigned to the vacated slot. Pure: the
 * caller supplies the live status and the ranked shortlist; we gate on both.
 */
export function decideAssignCandidate(input: AssignCandidateInput): SwapResolutionDecision {
  if (!isSwapResolvable(input.status)) return { ok: false, error: "not_open" };
  if (input.candidateId === input.requesterId) return { ok: false, error: "candidate_is_requester" };
  if (!input.eligibleMemberIds.includes(input.candidateId)) {
    return { ok: false, error: "candidate_not_eligible" };
  }
  return { ok: true, memberId: input.candidateId };
}

/** Decide whether an open swap may be cancelled. Only open swaps can. */
export function decideCancelSwap(status: SwapStatus | string): { ok: true } | { ok: false; error: "not_open" } {
  return isSwapResolvable(status) ? { ok: true } : { ok: false, error: "not_open" };
}
