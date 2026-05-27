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
  weights?: Partial<typeof DEFAULT_WEIGHTS>;
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

export type ScoreWeights = typeof DEFAULT_WEIGHTS;

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
  const daysSince = candidate.days_since_last_assignment_same_role
    ?? candidate.days_since_last_assignment
    ?? 90;
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
  const monthEquivalent = (candidate.accepted_recent_count / 90) * 30;
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

function isUnavailable(
  availabilities: Availability[],
  serviceStartsAt: Date,
): boolean {
  return availabilities.some((av) => coversDate(av, serviceStartsAt));
}

function coversDate(av: Availability, date: Date): boolean {
  const iso = date.toISOString().slice(0, 10);
  const p = av.pattern as Record<string, unknown>;
  if (av.kind === "specific" && Array.isArray(p.dates)) {
    return (p.dates as string[]).includes(iso);
  }
  if (av.kind === "range" && typeof p.from === "string" && typeof p.to === "string") {
    return iso >= p.from && iso <= p.to;
  }
  if (av.kind === "recurring" && typeof p.weekday === "string") {
    const day = date
      .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
      .toLowerCase();
    return p.weekday === day;
  }
  return false;
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

/** Re-export for callers that want type-only access. */
export type { Assignment };
