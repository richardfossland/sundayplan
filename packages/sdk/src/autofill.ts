/**
 * Auto-fill orchestrator — the deterministic core of Phase 5.2.
 *
 * Composes the scoring engine (`scoreCandidate`) with hard scheduling
 * constraints to turn a set of open slots into a proposed assignment set.
 * It is pure and deterministic: the same input always yields the same
 * proposal, which is what makes the auto-fill explainable and what the LLM
 * layer (Phase 5.3) sits *on top of* rather than replacing.
 *
 * Hard constraints enforced during the pass:
 *  - Availability — a candidate whose score is `null` (unavailable) is skipped.
 *  - No double-booking — once a member is assigned within a service, they are
 *    not considered for another role in that same service.
 * Soft signals (rotation, frequency, same-day, etc.) are already folded into
 * the score, or surfaced separately by the conflict engine; they bias the
 * ranking but never hard-block.
 *
 * Tie-breaking is fully deterministic (the plan's "tie scores: deterministic
 * tiebreaker" requirement): higher score wins, then earliest `joined_at`
 * (a `null` join date sorts last), then `member_id` ascending as a final
 * stable fallback.
 *
 * Cross-service assignment of the same member is allowed (they serve multiple
 * weeks); only same-service collisions are blocked.
 */

import type { ScoreBreakdown } from "@sundayplan/shared";
import { scoreCandidate, type ScoringInputs } from "./scoring";

export interface AutoFillCandidate {
  member_id: string;
  /** ISO date the member joined; earliest wins ties. `null` sorts last. */
  joined_at: string | null;
  /** Fully-built scoring inputs for this (candidate, slot) pair. */
  inputs: ScoringInputs;
  /**
   * Cumulative serves this member already carries coming INTO the planning
   * window — the global-fairness signal `balancedAutoFill` flattens against so
   * early-window volunteers aren't hammered. Default-safe: omitted/0 means
   * "no prior load", which leaves the base greedy `autoFill` unchanged.
   */
  window_serves_prior?: number;
  /**
   * A locked/manual assignment the planner has pinned to this slot. Pinned
   * members occupy the slot (counting toward load + double-booking) and are
   * NEVER moved by the balancing pass. Ignored by the base greedy `autoFill`.
   */
  pinned?: boolean;
}

export interface AutoFillSlot {
  service_id: string;
  role_id: string;
  /** How many people this slot needs (e.g. "2 vocalists"). */
  quantity: number;
  candidates: AutoFillCandidate[];
}

export interface ProposedAssignment {
  service_id: string;
  role_id: string;
  member_id: string;
  /** 1-based position among this slot's ranked candidates. */
  rank: number;
  score: ScoreBreakdown;
}

export type UnfilledReason = "no_eligible_candidates" | "insufficient_candidates";

export interface UnfilledSlot {
  service_id: string;
  role_id: string;
  needed: number;
  filled: number;
  reason: UnfilledReason;
}

export interface AutoFillResult {
  assignments: ProposedAssignment[];
  unfilled: UnfilledSlot[];
}

interface ScoredCandidate {
  member_id: string;
  joined_at: string | null;
  score: ScoreBreakdown;
}

/**
 * Fill the given slots in order. Slots are processed as provided, so the
 * caller controls priority (e.g. chronological, or most-constrained-first).
 */
export function autoFill(slots: AutoFillSlot[]): AutoFillResult {
  const assignments: ProposedAssignment[] = [];
  const unfilled: UnfilledSlot[] = [];
  const assignedInService = new Map<string, Set<string>>();

  for (const slot of slots) {
    let taken = assignedInService.get(slot.service_id);
    if (!taken) assignedInService.set(slot.service_id, (taken = new Set<string>()));

    const scored: ScoredCandidate[] = [];
    for (const c of slot.candidates) {
      const score = scoreCandidate(c.inputs);
      if (score === null) continue; // availability hard gate
      scored.push({ member_id: c.member_id, joined_at: c.joined_at, score });
    }
    scored.sort(compareCandidates);

    let filled = 0;
    for (let i = 0; i < scored.length && filled < slot.quantity; i++) {
      const cand = scored[i];
      if (taken.has(cand.member_id)) continue; // no double-book in this service
      assignments.push({
        service_id: slot.service_id,
        role_id: slot.role_id,
        member_id: cand.member_id,
        rank: i + 1,
        score: cand.score,
      });
      taken.add(cand.member_id);
      filled += 1;
    }

    if (filled < slot.quantity) {
      unfilled.push({
        service_id: slot.service_id,
        role_id: slot.role_id,
        needed: slot.quantity,
        filled,
        reason: scored.length === 0 ? "no_eligible_candidates" : "insufficient_candidates",
      });
    }
  }

  return { assignments, unfilled };
}

/** Deterministic ranking: score desc → earliest joined_at → member_id asc. */
function compareCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  if (b.score.total !== a.score.total) return b.score.total - a.score.total;
  if (a.joined_at !== b.joined_at) {
    if (a.joined_at === null) return 1;
    if (b.joined_at === null) return -1;
    return a.joined_at < b.joined_at ? -1 : 1;
  }
  if (a.member_id < b.member_id) return -1;
  if (a.member_id > b.member_id) return 1;
  return 0;
}
