/**
 * Auto-fill scoring engine — deterministic, pure functions.
 *
 * For a given (service, role) slot and a candidate member, score the
 * candidate from 0–100. This is the engine the auto-fill UX in Phase 5.2
 * calls per slot. The LLM in Phase 5.3 ONLY adjusts the inputs (weights,
 * hard exclusions); it never replaces this engine.
 *
 * Components (max contribution, summing to ~100):
 *  - skill_match        40
 *  - rotation_fairness  25
 *  - frequency_balance  15
 *  - burnout            10 (penalty)
 *  - pairing            10
 *  - variety             5
 *  - user_custom         5
 *
 * Availability is a hard gate — if the candidate is unavailable, the
 * engine returns `null` (signalling "skip"). Anything else is a soft
 * score.
 */

import type {
  Availability,
  Assignment,
  ScoreBreakdown,
  ScoreComponent,
  SkillLevel,
} from "@sundayplan/shared";
import { isUnavailable } from "@sundayplan/shared";

export interface ScoringInputs {
  /** The candidate member's relevant history. */
  candidate: {
    member_id: string;
    skill_level: SkillLevel;
    /** Total assignments accepted in the past 90 days. */
    accepted_recent_count: number;
    /** Distance in days since last assignment (any role). */
    days_since_last_assignment: number | null;
    /** Days since last assignment in THIS role specifically. */
    days_since_last_assignment_same_role: number | null;
    /** Target frequency, defaulting to the church's setting. */
    target_serves_per_month: number;
    /** Member's availability records. */
    availability: Availability[];
    /** Number of consecutive recent weeks this member has served. */
    consecutive_weeks_served: number;
    /** Has someone they often pair with been scheduled to this same service? */
    has_frequent_partner_on_service: boolean;
    /** If skill_level === 'training', is a 'trainer' on this service? */
    has_trainer_paired: boolean;
  };
  /** The slot we're trying to fill. */
  slot: {
    service_starts_at: Date;
    role_skill_required: SkillLevel;
  };
  /** Weights, defaults sensible per the build plan. */
  weights?: Partial<ScoreWeights>;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
// The Unix epoch (1970-01-01) is a Thursday, so raw `floor(t / WEEK)` buckets
// run Thu→Wed. Shifting +3 days moves the boundary to Monday 00:00 UTC, so
// buckets run Monday→Sunday — the church-week convention. (Verified: a Sunday
// ends its week and the next Monday starts a fresh bucket.)
const MONDAY_SHIFT_MS = 3 * DAY_MS;

/** Monday-anchored UTC week index for an instant. */
function weekIndex(t: number): number {
  return Math.floor((t + MONDAY_SHIFT_MS) / WEEK_MS);
}

/**
 * The trailing run of consecutive Mon–Sun weeks a member has served, counted
 * back from the present. Only an *active* streak counts: if the most recent
 * served week is more than one week before `now`'s week, the member has rested
 * and the run is 0 — a streak that ended long ago must not register as burnout.
 * Multiple services within the same week count once.
 */
export function consecutiveWeeksServed(servedDates: Date[], now: Date = new Date()): number {
  if (servedDates.length === 0) return 0;
  const weeks = [...new Set(servedDates.map((d) => weekIndex(d.getTime())))].sort((a, b) => b - a);
  const nowWeek = weekIndex(now.getTime());
  // The streak must reach up to (or into) the current planning week. A member
  // whose latest service is two+ weeks back is rested → not on a run.
  if (weeks[0] < nowWeek - 1) return 0;
  let run = 1;
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i] === weeks[i - 1] - 1) run++;
    else break;
  }
  return run;
}

export const DEFAULT_WEIGHTS = {
  skill_match:       40,
  rotation_fairness: 25,
  frequency_balance: 15,
  burnout:           10, // penalty cap
  pairing:           10,
  variety:            5,
  custom:             5,
} as const;

export type ScoreWeights = { [K in keyof typeof DEFAULT_WEIGHTS]: number };

/**
 * Returns `null` when the candidate fails a hard gate (availability).
 * Otherwise returns a 0–100 score with an explainability breakdown.
 */
export function scoreCandidate(input: ScoringInputs): ScoreBreakdown | null {
  const W = { ...DEFAULT_WEIGHTS, ...(input.weights ?? {}) };
  const { candidate, slot } = input;
  const components: ScoreComponent[] = [];
  const warnings: string[] = [];

  // ── Hard gate: availability ───────────────────────────────────────────────
  if (isUnavailable(candidate.availability, slot.service_starts_at)) {
    return null;
  }

  // ── 1. Skill match ────────────────────────────────────────────────────────
  const skillRaw = skillMatchRaw(candidate.skill_level, slot.role_skill_required);
  components.push({
    name: "skill_match",
    weight: W.skill_match,
    raw: skillRaw,
    contribution: skillRaw * W.skill_match,
    explanation:
      skillRaw === 1
        ? "perfect skill match"
        : skillRaw === 0.7
          ? "can do the role"
          : skillRaw === 0.4
            ? "training level — should pair with a trainer"
            : "skill mismatch",
  });

  // ── 2. Rotation fairness ──────────────────────────────────────────────────
  // More days since last assignment = higher fairness. 28 days = full score.
  const daysSinceRaw = candidate.days_since_last_assignment_same_role
    ?? candidate.days_since_last_assignment
    ?? 90;
  // Guard against clock skew / future-dated history: a "negative gap" must not
  // pull fairness below zero (it would otherwise subtract from the total).
  const daysSince = Math.max(0, daysSinceRaw);
  const fairnessRaw = Math.min(1, daysSince / 28);
  components.push({
    name: "rotation_fairness",
    weight: W.rotation_fairness,
    raw: fairnessRaw,
    contribution: fairnessRaw * W.rotation_fairness,
    explanation: `${daysSince} days since last assignment`,
  });

  // ── 3. Frequency balance ──────────────────────────────────────────────────
  // Distance from target serves/month — closer = better.
  // Negative counts can't happen from real data, but clamp defensively so the
  // monthly-equivalent rate is never negative.
  const monthEquivalent = (Math.max(0, candidate.accepted_recent_count) / 90) * 30;
  const distance = Math.abs(monthEquivalent - candidate.target_serves_per_month);
  const freqRaw = Math.max(0, 1 - distance / 4);
  components.push({
    name: "frequency_balance",
    weight: W.frequency_balance,
    raw: freqRaw,
    contribution: freqRaw * W.frequency_balance,
    explanation:
      distance < 1
        ? "near target serve frequency"
        : `~${monthEquivalent.toFixed(1)} of ${candidate.target_serves_per_month} target/month`,
  });

  // ── 4. Burnout penalty ────────────────────────────────────────────────────
  let burnoutPenalty = 0;
  if (candidate.consecutive_weeks_served >= 3) {
    burnoutPenalty = -W.burnout;
    warnings.push(
      `Has served ${candidate.consecutive_weeks_served} weeks in a row — consider rest`,
    );
  }
  components.push({
    name: "burnout",
    weight: W.burnout,
    raw: candidate.consecutive_weeks_served >= 3 ? -1 : 0,
    contribution: burnoutPenalty,
    explanation:
      candidate.consecutive_weeks_served >= 3
        ? `penalty: ${candidate.consecutive_weeks_served} weeks in a row`
        : "not burned out",
  });

  // ── 5. Pairing ────────────────────────────────────────────────────────────
  let pairingRaw = 0;
  let pairingExpl = "no special pairing signal";
  if (candidate.has_frequent_partner_on_service) {
    pairingRaw = 1;
    pairingExpl = "frequent partner already scheduled";
  }
  if (candidate.skill_level === "training" && candidate.has_trainer_paired) {
    pairingRaw = 1;
    pairingExpl = "training-level paired with a trainer";
  }
  components.push({
    name: "pairing",
    weight: W.pairing,
    raw: pairingRaw,
    contribution: pairingRaw * W.pairing,
    explanation: pairingExpl,
  });

  // ── 6. Variety ────────────────────────────────────────────────────────────
  // Simple: full bonus if same-role gap is bigger than any-role gap.
  const varietyRaw =
    candidate.days_since_last_assignment_same_role !== null &&
    candidate.days_since_last_assignment !== null &&
    candidate.days_since_last_assignment_same_role >
      candidate.days_since_last_assignment
      ? 1
      : 0.4;
  components.push({
    name: "variety",
    weight: W.variety,
    raw: varietyRaw,
    contribution: varietyRaw * W.variety,
    explanation: varietyRaw === 1
      ? "haven't done this exact role lately"
      : "neutral variety signal",
  });

  // ── 7. Custom (user-defined modifiers) — Phase 5.3 ────────────────────────
  components.push({
    name: "custom",
    weight: W.custom,
    raw: 0,
    contribution: 0,
    explanation: "no custom rules applied yet",
  });

  // ── Sum ───────────────────────────────────────────────────────────────────
  const total = clamp(components.reduce((sum, c) => sum + c.contribution, 0), 0, 100);

  return {
    total: Math.round(total * 10) / 10,
    components,
    warnings,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function skillMatchRaw(have: SkillLevel, need: SkillLevel): number {
  const order = { training: 0, capable: 1, lead: 2, trainer: 3 } as const;
  const h = order[have];
  const n = order[need];
  if (h === n) return 1;
  if (h > n) return 1; // overqualified is still perfect
  if (n - h === 1) return 0.7; // one step under
  if (n - h === 2) return 0.4; // two steps under (training when capable needed)
  return 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Sort candidates by total score desc; null scores filtered out. */
export function rankCandidates<T extends { score: ScoreBreakdown | null }>(
  list: T[],
): T[] {
  return list
    .filter((c) => c.score !== null)
    .sort((a, b) => (b.score!.total - a.score!.total));
}

// ── Phase 9: natural-language rationale refinement ────────────────────────────
//
// The scoring engine above is deterministic and ships terse, mechanical
// `explanation` strings ("28 days since last assignment", "skill mismatch").
// They are correct but read like a debugger. This seam lets an optional LLM
// rephrase them into warmer, planner-facing copy — WITHOUT touching the
// numbers, the ranking, or the engine itself. It mirrors the provider-seam
// discipline of channels.ts / setlist-ai.ts: pure core, optional model on top.
//
// Hard guarantees (all unit-tested):
//   • Offline-first. With no refiner (the default), the breakdown is returned
//     untouched — the existing strings are the graceful fallback.
//   • The refiner may ONLY rewrite the human-readable text. `total`, component
//     `contribution`/`raw`/`weight`/`name` are copied through verbatim, so a
//     misbehaving (or hallucinating) model can never change a score.
//   • Cached. Identical breakdowns hit an in-memory cache keyed by a structural
//     signature, so re-scoring the same slot doesn't re-request.

/** A short label for the kind of copy being refined, to steer tone. */
export type RationaleKind = "recommendation" | "conflict";

/** The text the refiner is allowed to rewrite for one breakdown. */
export interface RationaleDraft {
  kind: RationaleKind;
  /** The component explanations, in order, that may be polished. */
  explanations: string[];
  /** The warning lines that may be polished. */
  warnings: string[];
}

/**
 * The refinement provider seam. An implementation takes the terse draft copy
 * and returns warmer phrasings of the SAME shape (same array lengths, same
 * order). Returning anything mis-shaped is treated as a failure and the
 * original strings are kept — the caller never has to trust the model.
 *
 * Sync OR async: the offline default is sync; a real Claude-backed refiner is
 * async. `refineBreakdown` awaits either.
 */
export interface RationaleRefiner {
  refine(draft: RationaleDraft): RationaleDraft | Promise<RationaleDraft>;
}

/**
 * Build a stable cache key from a breakdown's *text* (the only thing the
 * refiner sees). Numbers are excluded on purpose: two slots with identical
 * rationale wording share a refinement regardless of their exact scores.
 */
export function rationaleCacheKey(kind: RationaleKind, b: ScoreBreakdown): string {
  const expl = b.components.map((c) => c.explanation).join("");
  const warn = b.warnings.join("");
  return `${kind}${expl}${warn}`;
}

/** Validate that a refiner's output is the right shape to safely apply. */
function isSafeRefinement(draft: RationaleDraft, out: unknown): out is RationaleDraft {
  if (!out || typeof out !== "object") return false;
  const r = out as Partial<RationaleDraft>;
  return (
    Array.isArray(r.explanations) &&
    Array.isArray(r.warnings) &&
    r.explanations.length === draft.explanations.length &&
    r.warnings.length === draft.warnings.length &&
    r.explanations.every((s) => typeof s === "string" && s.trim().length > 0) &&
    r.warnings.every((s) => typeof s === "string" && s.trim().length > 0)
  );
}

/**
 * Refine a single breakdown's copy through an optional refiner, with caching
 * and graceful fallback. Returns a NEW breakdown (numbers identical, text
 * possibly warmer). With `refiner` omitted/undefined the input is returned
 * essentially unchanged — the offline path.
 *
 * @param cache shared `Map` for memoization; pass the same one across calls in
 *              a scoring pass so repeated breakdowns reuse a single refinement.
 */
export async function refineBreakdown(
  breakdown: ScoreBreakdown,
  opts: {
    kind?: RationaleKind;
    refiner?: RationaleRefiner | null;
    cache?: Map<string, RationaleDraft>;
  } = {},
): Promise<ScoreBreakdown> {
  const kind = opts.kind ?? "recommendation";
  const refiner = opts.refiner;
  if (!refiner) return breakdown; // offline default — keep existing strings.

  const draft: RationaleDraft = {
    kind,
    explanations: breakdown.components.map((c) => c.explanation),
    warnings: [...breakdown.warnings],
  };

  const key = rationaleCacheKey(kind, breakdown);
  let refined = opts.cache?.get(key);

  if (!refined) {
    try {
      const out = await refiner.refine(draft);
      refined = isSafeRefinement(draft, out) ? out : draft; // fall back if mis-shaped.
    } catch {
      refined = draft; // any failure (network, key, throw) → keep originals.
    }
    opts.cache?.set(key, refined);
  }

  return {
    total: breakdown.total,
    warnings: refined.warnings,
    components: breakdown.components.map((c, i) => ({
      ...c,
      explanation: refined!.explanations[i] ?? c.explanation,
    })),
  };
}

/** Re-export for callers that want type-only access. */
export type { Assignment };
