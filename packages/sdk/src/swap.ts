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
