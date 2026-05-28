import { describe, expect, it } from "vitest";
import type { Availability, SkillLevel } from "@sundayplan/shared";
import {
  detectConflicts,
  previewCandidate,
  type ConflictContext,
  type MemberInfo,
  type PlacedAssignment,
  type ServiceInfo,
} from "./conflicts";

// Anchors: 2026-01-04 is a Sunday; consecutive Sundays follow at +7 days.
const SUN = ["2026-01-04", "2026-01-11", "2026-01-18", "2026-01-25"] as const;

function svc(id: string, iso: string, time = "T11:00:00Z"): ServiceInfo {
  return { id, starts_at: new Date(`${iso}${time}`) };
}

function member(id: string, overrides: Partial<MemberInfo> = {}): MemberInfo {
  return { id, availability: [], max_assignments_per_month: 4, ...overrides };
}

function asg(
  member_id: string,
  service_id: string,
  role_id: string,
  skill: SkillLevel = "capable",
  need: SkillLevel = "capable",
): PlacedAssignment {
  return { member_id, service_id, role_id, skill_level: skill, role_skill_required: need };
}

function specific(dates: string[]): Availability {
  return { id: "av", member_id: "m1", kind: "specific", pattern: { dates }, reason: null, reason_visibility: "planner" };
}

function only(rule: string, conflicts: ReturnType<typeof detectConflicts>) {
  return conflicts.filter((c) => c.rule === rule);
}

describe("rule 1 — double booking (hard)", () => {
  it("flags a member assigned to two roles in the same service", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1")],
      assignments: [asg("m1", "s1", "r1"), asg("m1", "s1", "r2")],
    };
    const hits = only("double_booking", detectConflicts(ctx));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: "hard", member_id: "m1", service_id: "s1" });
  });

  it("does not flag the same member in two different services", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0]), svc("s2", SUN[1])],
      members: [member("m1")],
      assignments: [asg("m1", "s1", "r1"), asg("m1", "s2", "r1")],
    };
    expect(only("double_booking", detectConflicts(ctx))).toHaveLength(0);
  });
});

describe("rule 2 — assigned during unavailability (hard)", () => {
  it("flags an assignment on a blocked date", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1", { availability: [specific([SUN[0]])] })],
      assignments: [asg("m1", "s1", "r1")],
    };
    const hits = only("unavailable", detectConflicts(ctx));
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("hard");
  });

  it("does not flag when the member is available", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1", { availability: [specific(["2026-02-01"])] })],
      assignments: [asg("m1", "s1", "r1")],
    };
    expect(only("unavailable", detectConflicts(ctx))).toHaveLength(0);
  });
});

describe("rule 3 — two services same day (soft)", () => {
  it("flags a member serving two services on one day", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0], "T09:00:00Z"), svc("s2", SUN[0], "T18:00:00Z")],
      members: [member("m1")],
      assignments: [asg("m1", "s1", "r1"), asg("m1", "s2", "r2")],
    };
    const hits = only("same_day", detectConflicts(ctx));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: "soft", member_id: "m1" });
  });
});

describe("rule 4 — over the monthly cap (soft)", () => {
  it("flags a member exceeding their cap within a month", () => {
    const ctx: ConflictContext = {
      // Mondays in Jan 2026 — distinct days, not Sundays (avoids other rules)
      services: [svc("s1", "2026-01-05"), svc("s2", "2026-01-12"), svc("s3", "2026-01-19")],
      members: [member("m1", { max_assignments_per_month: 2 })],
      assignments: [asg("m1", "s1", "r1"), asg("m1", "s2", "r1"), asg("m1", "s3", "r1")],
    };
    const hits = only("over_max_per_month", detectConflicts(ctx));
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toMatch(/exceeds the cap of 2/);
  });

  it("does not flag at or below the cap", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", "2026-01-05"), svc("s2", "2026-01-12")],
      members: [member("m1", { max_assignments_per_month: 2 })],
      assignments: [asg("m1", "s1", "r1"), asg("m1", "s2", "r1")],
    };
    expect(only("over_max_per_month", detectConflicts(ctx))).toHaveLength(0);
  });
});

describe("rule 6 — skill gap (soft)", () => {
  it("flags a member below the role's required skill", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1")],
      assignments: [asg("m1", "s1", "r1", "training", "lead")],
    };
    const hits = only("skill_gap", detectConflicts(ctx));
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toMatch(/needs "lead"/);
  });

  it("does not flag an overqualified member", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1")],
      assignments: [asg("m1", "s1", "r1", "trainer", "capable")],
    };
    expect(only("skill_gap", detectConflicts(ctx))).toHaveLength(0);
  });
});

describe("rule 7 — unfilled near deadline (soft)", () => {
  it("flags an under-filled requirement within the warning window", () => {
    const ctx: ConflictContext = {
      now: new Date("2026-01-01T00:00:00Z"),
      services: [svc("s1", "2026-01-05")], // 4 days out, inside default 7
      members: [member("m1")],
      assignments: [asg("m1", "s1", "r1")],
      requirements: [{ service_id: "s1", role_id: "r1", quantity: 2 }],
    };
    const hits = only("unfilled_near_deadline", detectConflicts(ctx));
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toMatch(/1\/2 filled/);
  });

  it("ignores requirements outside the warning window", () => {
    const ctx: ConflictContext = {
      now: new Date("2026-01-01T00:00:00Z"),
      services: [svc("s1", "2026-03-01")], // far out
      members: [member("m1")],
      assignments: [],
      requirements: [{ service_id: "s1", role_id: "r1", quantity: 2 }],
    };
    expect(only("unfilled_near_deadline", detectConflicts(ctx))).toHaveLength(0);
  });

  it("does not flag a fully filled requirement", () => {
    const ctx: ConflictContext = {
      now: new Date("2026-01-01T00:00:00Z"),
      services: [svc("s1", "2026-01-05")],
      members: [member("m1"), member("m2")],
      assignments: [asg("m1", "s1", "r1"), asg("m2", "s1", "r1")],
      requirements: [{ service_id: "s1", role_id: "r1", quantity: 2 }],
    };
    expect(only("unfilled_near_deadline", detectConflicts(ctx))).toHaveLength(0);
  });
});

describe("rule 8 — consecutive Sundays (soft)", () => {
  it("flags 4 Sundays in a row (cap 3)", () => {
    const ctx: ConflictContext = {
      services: SUN.map((d, i) => svc(`s${i}`, d)),
      members: [member("m1")],
      assignments: SUN.map((_, i) => asg("m1", `s${i}`, "r1")),
    };
    const hits = only("consecutive_sundays", detectConflicts(ctx));
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toMatch(/4 Sundays in a row/);
  });

  it("does not flag exactly 3 consecutive Sundays", () => {
    const ctx: ConflictContext = {
      services: SUN.slice(0, 3).map((d, i) => svc(`s${i}`, d)),
      members: [member("m1")],
      assignments: SUN.slice(0, 3).map((_, i) => asg("m1", `s${i}`, "r1")),
    };
    expect(only("consecutive_sundays", detectConflicts(ctx))).toHaveLength(0);
  });

  it("does not flag non-consecutive Sundays (a gap resets the run)", () => {
    const ctx: ConflictContext = {
      services: [svc("s0", SUN[0]), svc("s2", SUN[2]), svc("s3", SUN[3])],
      members: [member("m1")],
      // 01-04, then skip 01-11, then 01-18 + 01-25 → longest run is 2
      assignments: [asg("m1", "s0", "r1"), asg("m1", "s2", "r1"), asg("m1", "s3", "r1")],
    };
    expect(only("consecutive_sundays", detectConflicts(ctx))).toHaveLength(0);
  });
});

describe("clean schedule", () => {
  it("produces no conflicts for a well-formed snapshot", () => {
    const ctx: ConflictContext = {
      now: new Date("2026-01-01T00:00:00Z"),
      services: [svc("s1", SUN[0]), svc("s2", SUN[1])],
      members: [member("m1"), member("m2")],
      assignments: [
        asg("m1", "s1", "r1", "lead", "lead"),
        asg("m2", "s1", "r2", "capable", "capable"),
        asg("m1", "s2", "r1", "lead", "lead"),
        asg("m2", "s2", "r2", "capable", "capable"),
      ],
      requirements: [
        { service_id: "s1", role_id: "r1", quantity: 1 },
        { service_id: "s1", role_id: "r2", quantity: 1 },
      ],
    };
    expect(detectConflicts(ctx)).toEqual([]);
  });
});

describe("previewCandidate", () => {
  it("returns only conflicts involving the candidate member", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1", { availability: [specific([SUN[0]])] }), member("m2")],
      assignments: [asg("m2", "s1", "r2")], // m2 is fine
    };
    const conflicts = previewCandidate(ctx, asg("m1", "s1", "r1"));
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.every((c) => c.member_id === "m1")).toBe(true);
    expect(conflicts.some((c) => c.rule === "unavailable")).toBe(true);
  });

  it("detects a double-book the candidate would create", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1")],
      assignments: [asg("m1", "s1", "r1")],
    };
    const conflicts = previewCandidate(ctx, asg("m1", "s1", "r2"));
    expect(conflicts.some((c) => c.rule === "double_booking")).toBe(true);
  });

  it("returns nothing for a clean candidate", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1")],
      assignments: [],
    };
    expect(previewCandidate(ctx, asg("m1", "s1", "r1", "lead", "capable"))).toEqual([]);
  });
});
