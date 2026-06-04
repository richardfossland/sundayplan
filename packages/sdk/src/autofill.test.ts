import { describe, expect, it } from "vitest";
import type { Availability, SkillLevel } from "@sundayplan/shared";
import { autoFill, type AutoFillCandidate, type AutoFillSlot } from "./autofill";
import type { ScoringInputs } from "./scoring";

const SERVICE_DATE = new Date("2026-09-13T12:00:00Z");

// Baseline inputs that score 95 (lead), 83 (capable), 71 (training) against a
// `lead` slot — distinct totals so candidate ordering is unambiguous.
function inputs(skill: SkillLevel, need: SkillLevel = "lead"): ScoringInputs {
  return {
    candidate: {
      member_id: "x",
      skill_level: skill,
      accepted_recent_count: 6,
      days_since_last_assignment: 14,
      days_since_last_assignment_same_role: 28,
      target_serves_per_month: 2,
      availability: [],
      consecutive_weeks_served: 1,
      has_frequent_partner_on_service: true,
      has_trainer_paired: false,
    },
    slot: { service_starts_at: SERVICE_DATE, role_skill_required: need },
  };
}

const blockedToday: Availability = {
  id: "av",
  member_id: "x",
  kind: "specific",
  pattern: { dates: ["2026-09-13"] },
  reason: null,
  reason_visibility: "planner",
};

function cand(
  member_id: string,
  joined_at: string | null,
  skill: SkillLevel,
  opts: { unavailable?: boolean; need?: SkillLevel } = {},
): AutoFillCandidate {
  const i = inputs(skill, opts.need ?? "lead");
  return {
    member_id,
    joined_at,
    inputs: {
      ...i,
      candidate: {
        ...i.candidate,
        member_id,
        availability: opts.unavailable ? [blockedToday] : [],
      },
    },
  };
}

function slot(service_id: string, role_id: string, quantity: number, candidates: AutoFillCandidate[]): AutoFillSlot {
  return { service_id, role_id, quantity, candidates };
}

describe("autoFill — basic ranking", () => {
  it("assigns the highest-scoring candidate", () => {
    const res = autoFill([
      slot("s1", "r1", 1, [cand("a", "2020-01-01", "capable"), cand("b", "2020-01-01", "lead")]),
    ]);
    expect(res.unfilled).toEqual([]);
    expect(res.assignments).toHaveLength(1);
    expect(res.assignments[0]).toMatchObject({ member_id: "b", service_id: "s1", role_id: "r1", rank: 1 });
  });

  it("fills up to the requested quantity in rank order", () => {
    const res = autoFill([
      slot("s1", "r1", 2, [
        cand("a", "2020-01-01", "training"), // 71
        cand("b", "2020-01-01", "lead"), // 95
        cand("c", "2020-01-01", "capable"), // 83
      ]),
    ]);
    expect(res.unfilled).toEqual([]);
    expect(res.assignments.map((a) => a.member_id)).toEqual(["b", "c"]);
    expect(res.assignments.map((a) => a.rank)).toEqual([1, 2]);
  });
});

describe("autoFill — deterministic tiebreaker", () => {
  it("breaks ties by earliest joined_at", () => {
    const res = autoFill([
      slot("s1", "r1", 1, [
        cand("a", "2024-01-01", "lead"), // same score 95, joined later
        cand("b", "2020-01-01", "lead"), // same score 95, joined earlier → wins
      ]),
    ]);
    expect(res.assignments[0].member_id).toBe("b");
  });

  it("falls back to member_id when score and joined_at tie", () => {
    const res = autoFill([
      slot("s1", "r1", 1, [cand("z", null, "lead"), cand("a", null, "lead")]),
    ]);
    expect(res.assignments[0].member_id).toBe("a");
  });

  it("sorts a null joined_at after a known one on a score tie", () => {
    const res = autoFill([
      slot("s1", "r1", 1, [cand("a", null, "lead"), cand("b", "2023-06-01", "lead")]),
    ]);
    expect(res.assignments[0].member_id).toBe("b");
  });
});

describe("autoFill — scarcity", () => {
  it("leaves a slot empty with no_eligible_candidates when everyone is unavailable", () => {
    const res = autoFill([
      slot("s1", "r1", 1, [
        cand("a", "2020-01-01", "lead", { unavailable: true }),
        cand("b", "2020-01-01", "lead", { unavailable: true }),
      ]),
    ]);
    expect(res.assignments).toEqual([]);
    expect(res.unfilled).toEqual([
      { service_id: "s1", role_id: "r1", needed: 1, filled: 0, reason: "no_eligible_candidates" },
    ]);
  });

  it("partially fills and reports insufficient_candidates", () => {
    const res = autoFill([
      slot("s1", "r1", 2, [
        cand("a", "2020-01-01", "lead"),
        cand("b", "2020-01-01", "lead", { unavailable: true }),
      ]),
    ]);
    expect(res.assignments).toHaveLength(1);
    expect(res.assignments[0].member_id).toBe("a");
    expect(res.unfilled).toEqual([
      { service_id: "s1", role_id: "r1", needed: 2, filled: 1, reason: "insufficient_candidates" },
    ]);
  });
});

describe("autoFill — double-booking", () => {
  it("does not assign the same member to two roles in one service", () => {
    const res = autoFill([
      slot("s1", "r1", 1, [cand("a", "2020-01-01", "lead"), cand("b", "2020-01-01", "capable")]),
      slot("s1", "r2", 1, [cand("a", "2020-01-01", "lead"), cand("b", "2020-01-01", "capable")]),
    ]);
    const byRole = Object.fromEntries(res.assignments.map((x) => [x.role_id, x.member_id]));
    expect(byRole).toEqual({ r1: "a", r2: "b" });
    // r2's pick is the #2 ranked candidate (a was #1 but already taken)
    expect(res.assignments.find((x) => x.role_id === "r2")!.rank).toBe(2);
    const inS1 = res.assignments.filter((x) => x.service_id === "s1").map((x) => x.member_id);
    expect(new Set(inS1).size).toBe(inS1.length); // no duplicates
  });

  it("allows the same member across different services", () => {
    const res = autoFill([
      slot("s1", "r1", 1, [cand("a", "2020-01-01", "lead")]),
      slot("s2", "r1", 1, [cand("a", "2020-01-01", "lead")]),
    ]);
    expect(res.unfilled).toEqual([]);
    expect(res.assignments.map((x) => `${x.service_id}:${x.member_id}`)).toEqual(["s1:a", "s2:a"]);
  });
});

// ── Rest-window awareness (conflict rule 11) ─────────────────────────────────
describe("autoFill — minRestDays gate", () => {
  const DAY = 86_400_000;
  const D0 = new Date("2026-09-13T12:00:00Z"); // Sunday

  /** A candidate whose slot date + external committed dates are controllable. */
  function restCand(
    member_id: string,
    slotDate: Date,
    skill: SkillLevel,
    committed: Date[] = [],
  ): AutoFillCandidate {
    const i = inputs(skill, "lead");
    return {
      member_id,
      joined_at: "2020-01-01",
      committed_times: committed.map((d) => d.getTime()),
      inputs: {
        candidate: { ...i.candidate, member_id, availability: [] },
        slot: { service_starts_at: slotDate, role_skill_required: "lead" },
      },
    };
  }

  it("default (no minRestDays) is unchanged — back-to-back picks allowed", () => {
    const d1 = new Date(D0.getTime() + DAY); // next day
    const res = autoFill([
      slot("s1", "r1", 1, [restCand("a", D0, "lead")]),
      slot("s2", "r1", 1, [restCand("a", d1, "lead")]),
    ]);
    expect(res.assignments.map((x) => `${x.service_id}:${x.member_id}`)).toEqual(["s1:a", "s2:a"]);
  });

  it("skips a candidate within the window of a this-run pick", () => {
    const d1 = new Date(D0.getTime() + 2 * DAY); // 2 days later, window 6
    const res = autoFill(
      [
        slot("s1", "r1", 1, [restCand("a", D0, "lead")]),
        // s2: 'a' is too soon; 'b' is fresh → 'b' wins.
        slot("s2", "r1", 1, [restCand("a", d1, "lead"), restCand("b", d1, "lead")]),
      ],
      { minRestDays: 6 },
    );
    const byService = Object.fromEntries(res.assignments.map((x) => [x.service_id, x.member_id]));
    expect(byService).toEqual({ s1: "a", s2: "b" });
  });

  it("skips a candidate within the window of an EXISTING commitment", () => {
    const committed = new Date(D0.getTime() - 3 * DAY); // served 3 days before
    const res = autoFill(
      [slot("s1", "r1", 1, [restCand("a", D0, "lead", [committed]), restCand("b", D0, "lead")])],
      { minRestDays: 6 },
    );
    // 'a' (#1 by joined_at/id tie, both lead) is rest-blocked → 'b' fills it.
    expect(res.assignments).toHaveLength(1);
    expect(res.assignments[0].member_id).toBe("b");
  });

  it("allows a pick exactly at the window boundary (gap == minRestDays)", () => {
    const d1 = new Date(D0.getTime() + 6 * DAY); // exactly 6 days later
    const res = autoFill(
      [
        slot("s1", "r1", 1, [restCand("a", D0, "lead")]),
        slot("s2", "r1", 1, [restCand("a", d1, "lead")]),
      ],
      { minRestDays: 6 },
    );
    expect(res.assignments.map((x) => x.service_id)).toEqual(["s1", "s2"]);
  });

  it("leaves a slot unfilled when every candidate is rest-blocked", () => {
    const d1 = new Date(D0.getTime() + DAY);
    const res = autoFill(
      [
        slot("s1", "r1", 1, [restCand("a", D0, "lead")]),
        slot("s2", "r1", 1, [restCand("a", d1, "lead")]),
      ],
      { minRestDays: 6 },
    );
    expect(res.assignments.map((x) => x.service_id)).toEqual(["s1"]);
    expect(res.unfilled).toEqual([
      { service_id: "s2", role_id: "r1", needed: 1, filled: 0, reason: "insufficient_candidates" },
    ]);
  });
});
