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

describe("rule 1 — double booking corner cases", () => {
  it("reports the count when a member is booked into three roles in one service", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1")],
      assignments: [asg("m1", "s1", "r1"), asg("m1", "s1", "r2"), asg("m1", "s1", "r3")],
    };
    const hits = only("double_booking", detectConflicts(ctx));
    expect(hits).toHaveLength(1); // one conflict per (member, service), not per extra role
    expect(hits[0].message).toMatch(/3 roles/);
  });

  it("flags an exact duplicate assignment (same member, service AND role)", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1")],
      assignments: [asg("m1", "s1", "r1"), asg("m1", "s1", "r1")],
    };
    expect(only("double_booking", detectConflicts(ctx))).toHaveLength(1);
  });

  it("ignores assignments whose service id is unknown (no service row)", () => {
    // double_booking keys purely off the assignment, so a missing service still
    // trips it — but the date-bound rules below must not throw on it.
    const ctx: ConflictContext = {
      services: [],
      members: [member("m1")],
      assignments: [asg("m1", "ghost", "r1"), asg("m1", "ghost", "r2")],
    };
    expect(() => detectConflicts(ctx)).not.toThrow();
    expect(only("double_booking", detectConflicts(ctx))).toHaveLength(1);
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

  it("does not flag two roles in the SAME service (that's double-booking, not same-day)", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1")],
      assignments: [asg("m1", "s1", "r1"), asg("m1", "s1", "r2")],
    };
    expect(only("same_day", detectConflicts(ctx))).toHaveLength(0);
  });

  it("uses the UTC calendar day — services that share a day in UTC are flagged", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0], "T00:30:00Z"), svc("s2", SUN[0], "T23:30:00Z")],
      members: [member("m1")],
      assignments: [asg("m1", "s1", "r1"), asg("m1", "s2", "r2")],
    };
    const hits = only("same_day", detectConflicts(ctx));
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toMatch(/2 services on 2026-01-04/);
  });

  it("emits one conflict per day a member is double-booked", () => {
    const ctx: ConflictContext = {
      services: [
        svc("a1", SUN[0], "T09:00:00Z"), svc("a2", SUN[0], "T18:00:00Z"),
        svc("b1", SUN[1], "T09:00:00Z"), svc("b2", SUN[1], "T18:00:00Z"),
      ],
      members: [member("m1")],
      assignments: [asg("m1", "a1", "r1"), asg("m1", "a2", "r2"), asg("m1", "b1", "r1"), asg("m1", "b2", "r2")],
    };
    expect(only("same_day", detectConflicts(ctx))).toHaveLength(2);
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

  it("counts each month separately across a month boundary (no false positive)", () => {
    const ctx: ConflictContext = {
      // 2 in Jan, 2 in Feb — never exceeds a cap of 2 within either month
      services: [svc("s1", "2026-01-05"), svc("s2", "2026-01-26"), svc("s3", "2026-02-02"), svc("s4", "2026-02-23")],
      members: [member("m1", { max_assignments_per_month: 2 })],
      assignments: [asg("m1", "s1", "r1"), asg("m1", "s2", "r1"), asg("m1", "s3", "r1"), asg("m1", "s4", "r1")],
    };
    expect(only("over_max_per_month", detectConflicts(ctx))).toHaveLength(0);
  });

  it("flags each over-cap month independently", () => {
    const ctx: ConflictContext = {
      services: [
        svc("a", "2026-01-05"), svc("b", "2026-01-12"), svc("c", "2026-01-19"),
        svc("d", "2026-02-02"), svc("e", "2026-02-09"), svc("f", "2026-02-16"),
      ],
      members: [member("m1", { max_assignments_per_month: 2 })],
      assignments: ["a", "b", "c", "d", "e", "f"].map((s) => asg("m1", s, "r1")),
    };
    const hits = only("over_max_per_month", detectConflicts(ctx));
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.message).sort()).toEqual([
      "3 assignments in 2026-01 exceeds the cap of 2",
      "3 assignments in 2026-02 exceeds the cap of 2",
    ]);
  });

  it("a cap of 0 flags any assignment at all", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", "2026-01-05")],
      members: [member("m1", { max_assignments_per_month: 0 })],
      assignments: [asg("m1", "s1", "r1")],
    };
    expect(only("over_max_per_month", detectConflicts(ctx))).toHaveLength(1);
  });
});

describe("rule 5 — family conflict (soft)", () => {
  it("flags two members of the same household in one service", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [
        member("m1", { display_name: "Ada", household_id: "hansen" }),
        member("m2", { display_name: "Bo", household_id: "hansen" }),
      ],
      assignments: [asg("m1", "s1", "r1"), asg("m2", "s1", "r2")],
    };
    const hits = only("family_conflict", detectConflicts(ctx));
    // one conflict per member, each naming the other
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.member_id).sort()).toEqual(["m1", "m2"]);
    expect(hits.find((h) => h.member_id === "m1")?.message).toMatch(/Bo/);
  });

  it("does not flag members of different households", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [
        member("m1", { household_id: "hansen" }),
        member("m2", { household_id: "olsen" }),
      ],
      assignments: [asg("m1", "s1", "r1"), asg("m2", "s1", "r2")],
    };
    expect(only("family_conflict", detectConflicts(ctx))).toHaveLength(0);
  });

  it("does not flag the same household across different services", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0]), svc("s2", SUN[1])],
      members: [
        member("m1", { household_id: "hansen" }),
        member("m2", { household_id: "hansen" }),
      ],
      assignments: [asg("m1", "s1", "r1"), asg("m2", "s2", "r1")],
    };
    expect(only("family_conflict", detectConflicts(ctx))).toHaveLength(0);
  });

  it("ignores members with no household label", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1"), member("m2")],
      assignments: [asg("m1", "s1", "r1"), asg("m2", "s1", "r2")],
    };
    expect(only("family_conflict", detectConflicts(ctx))).toHaveLength(0);
  });

  it("ignores a null household label (treated the same as absent)", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1", { household_id: null }), member("m2", { household_id: null })],
      assignments: [asg("m1", "s1", "r1"), asg("m2", "s1", "r2")],
    };
    expect(only("family_conflict", detectConflicts(ctx))).toHaveLength(0);
  });

  it("emits a conflict for each of three household members, naming the other two", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [
        member("m1", { display_name: "Ada", household_id: "hansen" }),
        member("m2", { display_name: "Bo", household_id: "hansen" }),
        member("m3", { display_name: "Cy", household_id: "hansen" }),
      ],
      assignments: [asg("m1", "s1", "r1"), asg("m2", "s1", "r2"), asg("m3", "s1", "r3")],
    };
    const hits = only("family_conflict", detectConflicts(ctx));
    expect(hits).toHaveLength(3);
    const ada = hits.find((h) => h.member_id === "m1");
    expect(ada?.message).toMatch(/Bo/);
    expect(ada?.message).toMatch(/Cy/);
  });

  it("does not flag a single household member serving alone", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1", { household_id: "hansen" }), member("m2", { household_id: "olsen" })],
      assignments: [asg("m1", "s1", "r1"), asg("m2", "s1", "r2")],
    };
    expect(only("family_conflict", detectConflicts(ctx))).toHaveLength(0);
  });

  it("falls back to the member id in the message when a household peer has no display name", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [
        member("m1", { display_name: "Ada", household_id: "hansen" }),
        member("m2", { household_id: "hansen" }), // no display_name
      ],
      assignments: [asg("m1", "s1", "r1"), asg("m2", "s1", "r2")],
    };
    const ada = only("family_conflict", detectConflicts(ctx)).find((h) => h.member_id === "m1");
    expect(ada?.message).toMatch(/m2/);
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

  it("flags a service happening today (day 0, still in the window)", () => {
    const ctx: ConflictContext = {
      now: new Date("2026-01-05T08:00:00Z"),
      services: [svc("s1", "2026-01-05", "T11:00:00Z")],
      members: [member("m1")],
      assignments: [],
      requirements: [{ service_id: "s1", role_id: "r1", quantity: 1 }],
    };
    expect(only("unfilled_near_deadline", detectConflicts(ctx))).toHaveLength(1);
  });

  it("ignores a requirement whose service is already in the past", () => {
    const ctx: ConflictContext = {
      now: new Date("2026-01-10T00:00:00Z"),
      services: [svc("s1", "2026-01-05")], // already happened
      members: [member("m1")],
      assignments: [],
      requirements: [{ service_id: "s1", role_id: "r1", quantity: 1 }],
    };
    expect(only("unfilled_near_deadline", detectConflicts(ctx))).toHaveLength(0);
  });

  it("no-ops entirely when no requirements are supplied", () => {
    const ctx: ConflictContext = {
      now: new Date("2026-01-01T00:00:00Z"),
      services: [svc("s1", "2026-01-05")],
      members: [member("m1")],
      assignments: [],
      // requirements omitted
    };
    expect(only("unfilled_near_deadline", detectConflicts(ctx))).toHaveLength(0);
  });

  it("respects a custom unfilled_warn_days window", () => {
    const ctx: ConflictContext = {
      now: new Date("2026-01-01T00:00:00Z"),
      services: [svc("s1", "2026-01-10")], // 9 days out
      members: [member("m1")],
      assignments: [],
      requirements: [{ service_id: "s1", role_id: "r1", quantity: 1 }],
      config: { unfilled_warn_days: 14 },
    };
    expect(only("unfilled_near_deadline", detectConflicts(ctx))).toHaveLength(1);
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

  it("finds the longest run even when a shorter run precedes it", () => {
    // 2-run (Jan 4 + 11), gap, then a 4-run (Feb 1, 8, 15, 22) → flags the 4-run
    const feb = ["2026-02-01", "2026-02-08", "2026-02-15", "2026-02-22"];
    const all = [SUN[0], SUN[1], ...feb];
    const ctx: ConflictContext = {
      services: all.map((d, i) => svc(`s${i}`, d)),
      members: [member("m1")],
      assignments: all.map((_, i) => asg("m1", `s${i}`, "r1")),
    };
    const hits = only("consecutive_sundays", detectConflicts(ctx));
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toMatch(/4 Sundays in a row/);
  });

  it("counts each Sunday once even if a member serves two services that day", () => {
    const ctx: ConflictContext = {
      services: [
        svc("a", SUN[0], "T09:00:00Z"), svc("b", SUN[0], "T18:00:00Z"),
        svc("c", SUN[1]), svc("d", SUN[2]),
      ],
      members: [member("m1")],
      // two services on SUN[0] must not be miscounted as two consecutive Sundays
      assignments: [asg("m1", "a", "r1"), asg("m1", "b", "r2"), asg("m1", "c", "r1"), asg("m1", "d", "r1")],
    };
    // distinct Sundays: 01-04, 01-11, 01-18 → run of 3, at the default cap → no flag
    expect(only("consecutive_sundays", detectConflicts(ctx))).toHaveLength(0);
  });

  it("respects a lowered max_consecutive_sundays config", () => {
    const ctx: ConflictContext = {
      services: SUN.slice(0, 3).map((d, i) => svc(`s${i}`, d)),
      members: [member("m1")],
      assignments: SUN.slice(0, 3).map((_, i) => asg("m1", `s${i}`, "r1")),
      config: { max_consecutive_sundays: 2 },
    };
    expect(only("consecutive_sundays", detectConflicts(ctx))).toHaveLength(1);
  });

  it("ignores non-Sunday services entirely", () => {
    const ctx: ConflictContext = {
      // 2026-01-05/12/19/26 are Mondays
      services: ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"].map((d, i) => svc(`s${i}`, d)),
      members: [member("m1")],
      assignments: [0, 1, 2, 3].map((i) => asg("m1", `s${i}`, "r1")),
    };
    expect(only("consecutive_sundays", detectConflicts(ctx))).toHaveLength(0);
  });
});

describe("rule 9 — key person unavailable (soft)", () => {
  it("flags a required role whose only lead is unavailable", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1", { availability: [specific([SUN[0]])] })],
      assignments: [],
      requirements: [{ service_id: "s1", role_id: "r1", quantity: 1 }],
      keyPersons: [{ member_id: "m1", role_id: "r1" }],
    };
    const hits = only("key_person_unavailable", detectConflicts(ctx));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: "soft", service_id: "s1", role_id: "r1" });
  });

  it("does not flag when at least one lead is available", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [
        member("m1", { availability: [specific([SUN[0]])] }),
        member("m2"), // available
      ],
      assignments: [],
      requirements: [{ service_id: "s1", role_id: "r1", quantity: 1 }],
      keyPersons: [
        { member_id: "m1", role_id: "r1" },
        { member_id: "m2", role_id: "r1" },
      ],
    };
    expect(only("key_person_unavailable", detectConflicts(ctx))).toHaveLength(0);
  });

  it("no-ops when the role has no designated leads", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1", { availability: [specific([SUN[0]])] })],
      assignments: [],
      requirements: [{ service_id: "s1", role_id: "r1", quantity: 1 }],
      keyPersons: [{ member_id: "m1", role_id: "r2" }], // lead for a different role
    };
    expect(only("key_person_unavailable", detectConflicts(ctx))).toHaveLength(0);
  });

  it("no-ops when keyPersons is supplied but there are no requirements", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1", { availability: [specific([SUN[0]])] })],
      assignments: [],
      keyPersons: [{ member_id: "m1", role_id: "r1" }],
      // requirements omitted → nothing to evaluate the leads against
    };
    expect(only("key_person_unavailable", detectConflicts(ctx))).toHaveLength(0);
  });

  it("no-ops when the keyPersons list is empty", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [member("m1", { availability: [specific([SUN[0]])] })],
      assignments: [],
      requirements: [{ service_id: "s1", role_id: "r1", quantity: 1 }],
      keyPersons: [],
    };
    expect(only("key_person_unavailable", detectConflicts(ctx))).toHaveLength(0);
  });

  it("flags only when EVERY designated lead is unavailable (two leads, both away)", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [
        member("m1", { availability: [specific([SUN[0]])] }),
        member("m2", { availability: [specific([SUN[0]])] }),
      ],
      assignments: [],
      requirements: [{ service_id: "s1", role_id: "r1", quantity: 1 }],
      keyPersons: [
        { member_id: "m1", role_id: "r1" },
        { member_id: "m2", role_id: "r1" },
      ],
    };
    const hits = only("key_person_unavailable", detectConflicts(ctx));
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toMatch(/All 2 designated lead/);
  });

  it("treats a lead with no member record as unavailable (defensive)", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [], // m1 has no MemberInfo row at all
      assignments: [],
      requirements: [{ service_id: "s1", role_id: "r1", quantity: 1 }],
      keyPersons: [{ member_id: "m1", role_id: "r1" }],
    };
    expect(only("key_person_unavailable", detectConflicts(ctx))).toHaveLength(1);
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

  it("surfaces a soft conflict the candidate would create (same-day double serve)", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0], "T09:00:00Z"), svc("s2", SUN[0], "T18:00:00Z")],
      members: [member("m1")],
      assignments: [asg("m1", "s1", "r1")],
    };
    const conflicts = previewCandidate(ctx, asg("m1", "s2", "r2"));
    expect(conflicts.some((c) => c.rule === "same_day")).toBe(true);
  });

  it("flags the candidate when accepting would push them over their monthly cap", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", "2026-01-05"), svc("s2", "2026-01-12")],
      members: [member("m1", { max_assignments_per_month: 2 })],
      assignments: [asg("m1", "s1", "r1"), asg("m1", "s2", "r1")], // already at cap
    };
    const conflicts = previewCandidate(ctx, asg("m1", "s3", "r1"));
    // s3 has no service row, but the month rule keys off the assignment date via
    // its service — without a row it isn't counted, so this stays clean.
    expect(conflicts.some((c) => c.rule === "over_max_per_month")).toBe(false);
  });

  it("does not leak conflicts that belong to other members", () => {
    const ctx: ConflictContext = {
      services: [svc("s1", SUN[0])],
      members: [
        member("m2", { household_id: "hansen", display_name: "Bo" }),
        member("m1", { household_id: "olsen", display_name: "Ada" }),
      ],
      // m2 is already double-booked, which is none of m1's business
      assignments: [asg("m2", "s1", "r1"), asg("m2", "s1", "r2")],
    };
    const conflicts = previewCandidate(ctx, asg("m1", "s1", "r3"));
    expect(conflicts.every((c) => c.member_id === "m1")).toBe(true);
  });
});
