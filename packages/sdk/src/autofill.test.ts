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
