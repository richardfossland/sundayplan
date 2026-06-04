import { describe, expect, it } from "vitest";
import {
  buildChurnReport,
  buildRoleBalanceReport,
  churnReportToCsv,
  dayGapLocal,
  monthGapLocal,
  roleBalanceReportToCsv,
  DEFAULT_CHURN_CONFIG,
  type ChurnAssignment,
  type ChurnMember,
  type RoleQualification,
  type RoleRef,
  type RoleTarget,
} from "./analytics";

const NOW = "2026-06-04T12:00:00Z";

function member(
  memberId: string,
  name: string,
  joinedAtLocal: string | null,
  status: ChurnMember["status"] = "active",
): ChurnMember {
  return { memberId, name, joinedAtLocal, status };
}
function serve(memberId: string, date: string): ChurnAssignment {
  return { memberId, serviceDateLocal: `${date}T10:00:00Z` };
}

// ── date helpers ─────────────────────────────────────────────────────────────

describe("dayGapLocal / monthGapLocal", () => {
  it("counts calendar days, sign-correct, DST-stable", () => {
    expect(dayGapLocal("2026-06-01", "2026-06-08")).toBe(7);
    expect(dayGapLocal("2026-06-08", "2026-06-01")).toBe(-7);
    // span across a European DST change (last Sunday of March)
    expect(dayGapLocal("2026-03-28", "2026-03-30")).toBe(2);
    // ISO instants reduce to their local day
    expect(dayGapLocal("2026-06-01T23:00:00Z", "2026-06-02T01:00:00Z")).toBe(1);
  });

  it("only counts a whole month once day-of-month is reached", () => {
    expect(monthGapLocal("2026-01-31", "2026-02-15")).toBe(0);
    expect(monthGapLocal("2026-01-15", "2026-02-15")).toBe(1);
    expect(monthGapLocal("2026-01-15", "2026-02-14")).toBe(0);
    expect(monthGapLocal("2025-06-04", "2026-06-04")).toBe(12);
  });
});

// ── churn: first-serve histogram ─────────────────────────────────────────────

describe("buildChurnReport — time-to-first-assignment buckets", () => {
  it("partitions every served member with a join date into exactly one bucket", () => {
    const members = [
      member("a", "Ann", "2026-01-01"), // first serve +5d → 0-7
      member("b", "Bo", "2026-01-01"), // first serve +30d → 8-30
      member("c", "Cy", "2026-01-01"), // first serve +200d → 91+
      member("d", "Di", "2026-01-01"), // never served
    ];
    const assignments = [
      serve("a", "2026-01-06"),
      serve("b", "2026-01-31"),
      serve("c", "2026-07-20"),
    ];
    const r = buildChurnReport(members, assignments, NOW);
    const counts = Object.fromEntries(r.firstServeBuckets.map((b) => [b.key, b.count]));
    expect(counts).toEqual({ "0-7": 1, "8-30": 1, "31-90": 0, "91+": 1 });
    // sum of buckets + unknown == everyone who served
    const bucketTotal = r.firstServeBuckets.reduce((n, b) => n + b.count, 0) + r.firstServeUnknown;
    expect(bucketTotal).toBe(r.totals.everServed);
    expect(r.totals.everServed).toBe(3);
  });

  it("bucket edges are inclusive on the upper bound (boundary)", () => {
    // exactly 7 days → first bucket; exactly 8 → second.
    const members = [member("a", "Ann", "2026-01-01"), member("b", "Bo", "2026-01-01")];
    const r = buildChurnReport(
      members,
      [serve("a", "2026-01-08"), serve("b", "2026-01-09")],
      NOW,
    );
    const counts = Object.fromEntries(r.firstServeBuckets.map((b) => [b.key, b.count]));
    expect(counts["0-7"]).toBe(1); // +7 days inclusive
    expect(counts["8-30"]).toBe(1); // +8 days
  });

  it("served members without a join date go to firstServeUnknown, not a bucket", () => {
    const r = buildChurnReport([member("a", "Ann", null)], [serve("a", "2026-02-01")], NOW);
    expect(r.firstServeUnknown).toBe(1);
    expect(r.firstServeBuckets.reduce((n, b) => n + b.count, 0)).toBe(0);
  });

  it("clamps a serve dated before the join to 0 days", () => {
    const r = buildChurnReport([member("a", "Ann", "2026-02-01")], [serve("a", "2026-01-15")], NOW);
    expect(r.firstServeBuckets[0]).toMatchObject({ key: "0-7", count: 1 });
  });

  it("uses the EARLIEST serve as first-serve", () => {
    const r = buildChurnReport(
      [member("a", "Ann", "2026-01-01")],
      [serve("a", "2026-05-01"), serve("a", "2026-01-03"), serve("a", "2026-03-01")],
      NOW,
    );
    expect(r.firstServeBuckets[0]).toMatchObject({ key: "0-7", count: 1 }); // +2 days
  });
});

// ── churn: dropout signal ─────────────────────────────────────────────────────

describe("buildChurnReport — dropout (joined long ago, never served)", () => {
  it("flags never-served members joined ≥ N months ago (inclusive boundary)", () => {
    const members = [
      member("a", "Ann", "2026-03-04"), // exactly 3 months ago → dropout (inclusive)
      member("b", "Bo", "2026-03-05"), // < 3 months → safe
      member("c", "Cy", "2025-12-01"), // long ago → dropout
      member("d", "Di", "2026-01-01"), // joined long ago but HAS served → not dropout
    ];
    const r = buildChurnReport(members, [serve("d", "2026-05-01")], NOW); // default 3 months
    expect(r.dropout.map((x) => x.memberId)).toEqual(["c", "a"]); // longest dormant first
    expect(r.dropout[1]).toMatchObject({ monthsSinceJoin: 3 });
  });

  it("respects a custom dropoutJoinedMonths threshold", () => {
    const members = [member("a", "Ann", "2026-04-04")]; // 2 months ago
    expect(buildChurnReport(members, [], NOW, { dropoutJoinedMonths: 2 }).dropout).toHaveLength(1);
    expect(buildChurnReport(members, [], NOW, { dropoutJoinedMonths: 3 }).dropout).toHaveLength(0);
  });

  it("never flags a member without a join date", () => {
    expect(buildChurnReport([member("a", "Ann", null)], [], NOW).dropout).toHaveLength(0);
  });
});

// ── churn: at-risk signal ─────────────────────────────────────────────────────

describe("buildChurnReport — at-risk (served before, now silent)", () => {
  it("flags active members silent ≥ 14 days (inclusive boundary)", () => {
    // NOW = 2026-06-04. 14 days ago = 2026-05-21.
    const members = [
      member("a", "Ann", "2026-01-01"),
      member("b", "Bo", "2026-01-01"),
      member("c", "Cy", "2026-01-01"),
    ];
    const assignments = [
      serve("a", "2026-05-21"), // exactly 14 days → at-risk (inclusive)
      serve("b", "2026-05-22"), // 13 days → safe
      serve("c", "2026-04-01"), // long ago → at-risk
    ];
    const r = buildChurnReport(members, assignments, NOW);
    expect(r.atRisk.map((x) => x.memberId)).toEqual(["c", "a"]); // most overdue first
    expect(r.atRisk[1]).toMatchObject({ daysSinceLastServe: 14, lastServeLocal: "2026-05-21" });
  });

  it("uses the LATEST serve and excludes never-served + non-active members", () => {
    const members = [
      member("a", "Ann", "2026-01-01"), // last serve recent → safe despite an old one
      member("b", "Bo", "2026-01-01"), // never served → not at-risk
      member("c", "Cy", "2026-01-01", "inactive"), // silent but inactive → not at-risk
    ];
    const assignments = [serve("a", "2026-01-01"), serve("a", "2026-06-02"), serve("c", "2026-01-01")];
    const r = buildChurnReport(members, assignments, NOW);
    expect(r.atRisk).toHaveLength(0);
  });
});

// ── churn: retention snapshot ─────────────────────────────────────────────────

describe("buildChurnReport — retention snapshot", () => {
  it("computes % still active among members past each horizon", () => {
    const members = [
      member("a", "Ann", "2024-01-01", "active"), // past all horizons, active
      member("b", "Bo", "2024-01-01", "inactive"), // past all horizons, churned
      member("c", "Cy", "2026-05-01", "active"), // ~1 month → not eligible at 3/6/12
    ];
    const r = buildChurnReport(members, [], NOW);
    const byHorizon = Object.fromEntries(r.retention.map((p) => [p.months, p]));
    expect(byHorizon[3]).toMatchObject({ eligible: 2, stillActive: 1, rate: 0.5 });
    expect(byHorizon[6]).toMatchObject({ eligible: 2, stillActive: 1, rate: 0.5 });
    expect(byHorizon[12]).toMatchObject({ eligible: 2, stillActive: 1, rate: 0.5 });
  });

  it("rate is null when nobody is eligible at a horizon", () => {
    const r = buildChurnReport([member("a", "Ann", "2026-06-01")], [], NOW);
    expect(r.retention.every((p) => p.rate === null && p.eligible === 0)).toBe(true);
  });
});

// ── churn: determinism + empty ────────────────────────────────────────────────

describe("buildChurnReport — determinism + empties", () => {
  it("handles empty inputs without throwing", () => {
    const r = buildChurnReport([], [], NOW);
    expect(r.totals).toEqual({ members: 0, activeMembers: 0, everServed: 0, neverServed: 0 });
    expect(r.dropout).toEqual([]);
    expect(r.atRisk).toEqual([]);
    expect(r.firstServeBuckets.every((b) => b.count === 0)).toBe(true);
    expect(r.retention.every((p) => p.rate === null)).toBe(true);
  });

  it("is deterministic regardless of input ordering", () => {
    const members = [member("a", "Ann", "2025-01-01"), member("b", "Bo", "2026-03-01")];
    const asg = [serve("a", "2025-01-10"), serve("a", "2026-04-01")];
    const a = buildChurnReport(members, asg, NOW);
    const b = buildChurnReport([...members].reverse(), [...asg].reverse(), NOW);
    expect(a).toEqual(b);
  });

  it("exposes the resolved config (defaults merged)", () => {
    const r = buildChurnReport([], [], NOW, { atRiskSilentDays: 21 });
    expect(r.config).toEqual({ ...DEFAULT_CHURN_CONFIG, atRiskSilentDays: 21 });
  });
});

// ── role balance ──────────────────────────────────────────────────────────────

function role(roleId: string, roleName: string, teamName: string | null = null): RoleRef {
  return { roleId, roleName, teamName };
}
function qual(roleId: string, memberId: string, active = true): RoleQualification {
  return { roleId, memberId, active };
}
function target(roleId: string, t: number): RoleTarget {
  return { roleId, target: t };
}

describe("buildRoleBalanceReport", () => {
  it("signs over/under/balanced correctly vs target (active qualified)", () => {
    const roles = [role("r1", "Drums"), role("r2", "Sound"), role("r3", "Vocals")];
    const quals = [
      qual("r1", "m1"),
      qual("r1", "m2"),
      qual("r1", "m3"), // 3 active vs target 2 → over (+1)
      qual("r2", "m1"), // 1 active vs target 1 → balanced (0)
      qual("r3", "m4"), // 1 active vs target 3 → under (−2)
    ];
    const targets = [target("r1", 2), target("r2", 1), target("r3", 3)];
    const r = buildRoleBalanceReport(roles, quals, targets);
    const byRole = Object.fromEntries(r.lines.map((l) => [l.roleId, l]));
    expect(byRole.r1).toMatchObject({ activeQualified: 3, delta: 1, status: "over" });
    expect(byRole.r2).toMatchObject({ activeQualified: 1, delta: 0, status: "balanced" });
    expect(byRole.r3).toMatchObject({ activeQualified: 1, delta: -2, status: "under" });
  });

  it("counts DISTINCT members and excludes inactive from activeQualified", () => {
    const r = buildRoleBalanceReport(
      [role("r1", "Drums")],
      [qual("r1", "m1"), qual("r1", "m1"), qual("r1", "m2", false)], // m1 twice, m2 inactive
      [target("r1", 2)],
    );
    expect(r.lines[0]).toMatchObject({ qualified: 2, activeQualified: 1, delta: -1, status: "under" });
  });

  it("shows roles with no qualified members (capacity 0)", () => {
    const r = buildRoleBalanceReport([role("r1", "Drums")], [], [target("r1", 2)]);
    expect(r.lines[0]).toMatchObject({ qualified: 0, activeQualified: 0, delta: -2 });
  });

  it("leaves delta/status null when no target is configured", () => {
    const r = buildRoleBalanceReport([role("r1", "Drums")], [qual("r1", "m1")]);
    expect(r.lines[0]).toMatchObject({ target: null, delta: null, status: null });
    expect(r.totals.rolesWithTarget).toBe(0);
  });

  it("sorts most under-staffed first, untargeted roles last", () => {
    const roles = [role("over", "Over"), role("under", "Under"), role("none", "NoTarget")];
    const quals = [qual("over", "a"), qual("over", "b"), qual("over", "c"), qual("under", "a")];
    const targets = [target("over", 1), target("under", 3)];
    const r = buildRoleBalanceReport(roles, quals, targets);
    expect(r.lines.map((l) => l.roleId)).toEqual(["under", "over", "none"]);
  });

  it("aggregates totals: under/over counts + total shortfall", () => {
    const roles = [role("r1", "A"), role("r2", "B"), role("r3", "C")];
    const quals = [qual("r2", "x"), qual("r2", "y"), qual("r2", "z")];
    const targets = [target("r1", 2), target("r2", 1), target("r3", 4)];
    // r1: 0 vs 2 → under(−2); r2: 3 vs 1 → over(+2); r3: 0 vs 4 → under(−4)
    const r = buildRoleBalanceReport(roles, quals, targets);
    expect(r.totals).toMatchObject({
      roles: 3,
      rolesWithTarget: 3,
      underStaffed: 2,
      overStaffed: 1,
      totalShortfall: 6,
    });
  });

  it("ignores qualifications/targets for unknown role ids", () => {
    const r = buildRoleBalanceReport(
      [role("r1", "A")],
      [qual("r1", "m1"), qual("ghost", "m9")],
      [target("r1", 1), target("ghost", 5)],
    );
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ activeQualified: 1, delta: 0 });
  });

  it("handles empty inputs", () => {
    const r = buildRoleBalanceReport([], [], []);
    expect(r.lines).toEqual([]);
    expect(r.totals).toEqual({ roles: 0, rolesWithTarget: 0, underStaffed: 0, overStaffed: 0, totalShortfall: 0 });
  });

  it("is deterministic regardless of input ordering", () => {
    const roles = [role("r1", "A"), role("r2", "B")];
    const quals = [qual("r1", "m1"), qual("r2", "m2"), qual("r1", "m3")];
    const targets = [target("r1", 1), target("r2", 5)];
    const a = buildRoleBalanceReport(roles, quals, targets);
    const b = buildRoleBalanceReport([...roles].reverse(), [...quals].reverse(), [...targets].reverse());
    expect(a).toEqual(b);
  });
});

// ── CSV serializers ───────────────────────────────────────────────────────────

describe("CSV serializers", () => {
  it("churnReportToCsv emits one section column + escapes fields", () => {
    const r = buildChurnReport(
      [member("a", "Ann, Jr", "2026-03-04")], // comma in name forces quoting
      [],
      NOW,
    );
    const csv = churnReportToCsv(r);
    const head = csv.split("\n")[0];
    expect(head).toBe("section,key,label,value,detail");
    expect(csv).toContain('dropout,a,"Ann, Jr",3,2026-03-04');
    expect(csv).toContain("retention,3m,3 months,");
  });

  it("roleBalanceReportToCsv emits a header + a row per role with signed delta", () => {
    const r = buildRoleBalanceReport([role("r1", "Drums", "Band")], [], [target("r1", 2)]);
    const csv = roleBalanceReportToCsv(r);
    expect(csv.split("\n")[0]).toBe("role,team,qualified,active_qualified,target,delta,status");
    expect(csv).toContain("Drums,Band,0,0,2,-2,under");
  });

  it("empty role report still emits a header row", () => {
    expect(roleBalanceReportToCsv(buildRoleBalanceReport([], [], []))).toBe(
      "role,team,qualified,active_qualified,target,delta,status",
    );
  });
});
