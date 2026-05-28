import { describe, expect, it } from "vitest";
import type { Availability, ScoreBreakdown, SkillLevel } from "@sundayplan/shared";
import { DEFAULT_WEIGHTS, rankCandidates, scoreCandidate, type ScoringInputs } from "./scoring";

/**
 * Baseline candidate that lands on a clean, fully-derivable score so each
 * test can vary exactly one axis. With these inputs and a `lead` slot:
 *   skill 40 + fairness 25 + frequency 15 + burnout 0 + pairing 10 + variety 5 = 95
 */
function makeInput(overrides: {
  candidate?: Partial<ScoringInputs["candidate"]>;
  slot?: Partial<ScoringInputs["slot"]>;
  weights?: ScoringInputs["weights"];
} = {}): ScoringInputs {
  return {
    candidate: {
      member_id: "m-1",
      skill_level: "lead",
      accepted_recent_count: 6, // (6/90)*30 = 2.0/month
      days_since_last_assignment: 14,
      days_since_last_assignment_same_role: 28,
      target_serves_per_month: 2,
      availability: [],
      consecutive_weeks_served: 1,
      has_frequent_partner_on_service: true,
      has_trainer_paired: false,
      ...overrides.candidate,
    },
    slot: {
      service_starts_at: new Date("2026-09-13T12:00:00Z"),
      role_skill_required: "lead",
      ...overrides.slot,
    },
    weights: overrides.weights,
  };
}

function component(b: ScoreBreakdown, name: string) {
  const c = b.components.find((x) => x.name === name);
  if (!c) throw new Error(`no component ${name}`);
  return c;
}

describe("scoreCandidate — worked fixtures", () => {
  it("strong candidate sums to 95.0 with no warnings", () => {
    const b = scoreCandidate(makeInput());
    expect(b).not.toBeNull();
    expect(b!.total).toBe(95.0);
    expect(b!.warnings).toEqual([]);
  });

  it("mid candidate (under-skilled, burned out) sums to 37.5 with a burnout warning", () => {
    const b = scoreCandidate(
      makeInput({
        candidate: {
          skill_level: "capable", // vs lead → 0.7 → 28
          accepted_recent_count: 9, // 3.0/month, target 2 → dist 1 → 0.75 → 11.25
          days_since_last_assignment: 7, // same_role null → 7 → 0.25 → 6.25
          days_since_last_assignment_same_role: null,
          consecutive_weeks_served: 3, // burnout -10
          has_frequent_partner_on_service: false,
        },
      }),
    );
    expect(b).not.toBeNull();
    expect(b!.total).toBe(37.5);
    expect(b!.warnings).toHaveLength(1);
    expect(b!.warnings[0]).toMatch(/3 weeks in a row/);
  });
});

describe("availability hard gate", () => {
  const av = (kind: Availability["kind"], pattern: Availability["pattern"]): Availability => ({
    id: "av",
    member_id: "m-1",
    kind,
    pattern,
    reason: null,
    reason_visibility: "planner",
  });

  it("returns null for a recurring weekday match (2026-01-07 is a Wednesday)", () => {
    const b = scoreCandidate(
      makeInput({
        candidate: { availability: [av("recurring", { weekday: "wednesday" })] },
        slot: { service_starts_at: new Date("2026-01-07T12:00:00Z") },
      }),
    );
    expect(b).toBeNull();
  });

  it("does NOT gate when the recurring weekday differs (Thursday service)", () => {
    const b = scoreCandidate(
      makeInput({
        candidate: { availability: [av("recurring", { weekday: "wednesday" })] },
        slot: { service_starts_at: new Date("2026-01-08T12:00:00Z") },
      }),
    );
    expect(b).not.toBeNull();
  });

  it("returns null inside a date range and scores outside it", () => {
    const range = av("range", { from: "2026-06-15", to: "2026-06-30" });
    expect(
      scoreCandidate(makeInput({ candidate: { availability: [range] }, slot: { service_starts_at: new Date("2026-06-20T12:00:00Z") } })),
    ).toBeNull();
    expect(
      scoreCandidate(makeInput({ candidate: { availability: [range] }, slot: { service_starts_at: new Date("2026-07-05T12:00:00Z") } })),
    ).not.toBeNull();
  });

  it("returns null for a specific blocked date", () => {
    const b = scoreCandidate(
      makeInput({
        candidate: { availability: [av("specific", { dates: ["2026-09-13"] })] },
        slot: { service_starts_at: new Date("2026-09-13T12:00:00Z") },
      }),
    );
    expect(b).toBeNull();
  });
});

describe("skill_match tiers", () => {
  const cases: Array<[SkillLevel, SkillLevel, number]> = [
    ["lead", "lead", 1], // exact
    ["trainer", "lead", 1], // overqualified
    ["capable", "lead", 0.7], // one step under
    ["training", "lead", 0.4], // two steps under
    ["training", "trainer", 0], // three steps under
  ];
  for (const [have, need, expected] of cases) {
    it(`${have} for a ${need} slot → raw ${expected}`, () => {
      const b = scoreCandidate(makeInput({ candidate: { skill_level: have }, slot: { role_skill_required: need } }));
      expect(b).not.toBeNull();
      expect(component(b!, "skill_match").raw).toBe(expected);
    });
  }
});

describe("rotation_fairness", () => {
  it("caps at full score after 28 days (same-role gap wins)", () => {
    const b = scoreCandidate(makeInput({ candidate: { days_since_last_assignment_same_role: 56, days_since_last_assignment: 3 } }));
    expect(component(b!, "rotation_fairness").raw).toBe(1);
  });

  it("scales linearly below 28 days", () => {
    const b = scoreCandidate(makeInput({ candidate: { days_since_last_assignment_same_role: 14, days_since_last_assignment: 14 } }));
    expect(component(b!, "rotation_fairness").raw).toBeCloseTo(0.5, 5);
  });

  it("treats a member with no history as maximally fair (defaults to 90 days)", () => {
    const b = scoreCandidate(makeInput({ candidate: { days_since_last_assignment_same_role: null, days_since_last_assignment: null } }));
    expect(component(b!, "rotation_fairness").raw).toBe(1);
    expect(component(b!, "rotation_fairness").explanation).toMatch(/90 days/);
  });
});

describe("frequency_balance", () => {
  it("is maximal at the target serve frequency", () => {
    const b = scoreCandidate(makeInput({ candidate: { accepted_recent_count: 6, target_serves_per_month: 2 } }));
    expect(component(b!, "frequency_balance").raw).toBe(1);
  });

  it("floors at 0 when far above target", () => {
    const b = scoreCandidate(makeInput({ candidate: { accepted_recent_count: 21, target_serves_per_month: 2 } }));
    expect(component(b!, "frequency_balance").raw).toBe(0);
  });
});

describe("burnout penalty", () => {
  it("applies a penalty and warning at 3+ consecutive weeks", () => {
    const b = scoreCandidate(makeInput({ candidate: { consecutive_weeks_served: 4 } }));
    expect(component(b!, "burnout").contribution).toBe(-DEFAULT_WEIGHTS.burnout);
    expect(b!.warnings.some((w) => /weeks in a row/.test(w))).toBe(true);
  });

  it("no penalty below the threshold", () => {
    const b = scoreCandidate(makeInput({ candidate: { consecutive_weeks_served: 2 } }));
    expect(component(b!, "burnout").contribution).toBe(0);
    expect(b!.warnings).toEqual([]);
  });
});

describe("pairing", () => {
  it("rewards a training-level member paired with a trainer", () => {
    const b = scoreCandidate(
      makeInput({
        candidate: { skill_level: "training", has_frequent_partner_on_service: false, has_trainer_paired: true },
        slot: { role_skill_required: "capable" },
      }),
    );
    expect(component(b!, "pairing").raw).toBe(1);
    expect(component(b!, "pairing").explanation).toMatch(/trainer/);
  });

  it("gives no pairing bonus when neither signal is present", () => {
    const b = scoreCandidate(makeInput({ candidate: { has_frequent_partner_on_service: false, has_trainer_paired: false } }));
    expect(component(b!, "pairing").raw).toBe(0);
  });
});

describe("weights + clamping", () => {
  it("respects a zeroed weight", () => {
    const b = scoreCandidate(makeInput({ weights: { skill_match: 0 } }));
    expect(component(b!, "skill_match").contribution).toBe(0);
  });

  it("clamps the total to 100", () => {
    const b = scoreCandidate(makeInput({ weights: { skill_match: 200 } }));
    expect(b!.total).toBe(100);
  });

  it("clamps the total to 0 (never negative)", () => {
    const b = scoreCandidate(
      makeInput({
        candidate: {
          skill_level: "training",
          days_since_last_assignment_same_role: 0,
          days_since_last_assignment: 0,
          accepted_recent_count: 30, // way over target → freq 0
          consecutive_weeks_served: 5, // burnout -10
          has_frequent_partner_on_service: false,
        },
        slot: { role_skill_required: "trainer" }, // skill 0
      }),
    );
    expect(b!.total).toBe(0);
  });
});

describe("rankCandidates", () => {
  const bd = (total: number): ScoreBreakdown => ({ total, components: [], warnings: [] });

  it("filters out unavailable (null) candidates and sorts by score desc", () => {
    const ranked = rankCandidates([
      { id: "a", score: bd(50) },
      { id: "b", score: null },
      { id: "c", score: bd(80) },
      { id: "d", score: bd(65) },
    ]);
    expect(ranked.map((c) => c.id)).toEqual(["c", "d", "a"]);
  });

  it("returns an empty list when everyone is unavailable", () => {
    expect(rankCandidates([{ id: "a", score: null }, { id: "b", score: null }])).toEqual([]);
  });
});
