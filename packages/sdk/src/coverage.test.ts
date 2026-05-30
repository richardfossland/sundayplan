import { describe, expect, it } from "vitest";
import {
  buildServiceCoverage,
  buildVolunteerBalance,
  monthsInRange,
  type CoverageRow,
  type ServeRow,
} from "./coverage";

const FROM = "2026-04-01";
const TO = "2026-07-01"; // Q2 — 3 months

function serve(memberId: string, name: string, serviceId: string, date: string, target: number | null = null): ServeRow {
  return { memberId, name, serviceId, serviceDateLocal: `${date}T10:00:00Z`, targetPerMonth: target };
}

describe("monthsInRange", () => {
  it("counts whole calendar months, at least 1", () => {
    expect(monthsInRange("2026-04-01", "2026-07-01")).toBe(3);
    expect(monthsInRange("2026-04-10", "2026-04-20")).toBe(1);
    expect(monthsInRange("2026-01-01", "2027-01-01")).toBe(12);
  });
});

describe("buildVolunteerBalance", () => {
  it("counts serves and distinct services per member, sorted by load", () => {
    const rows = [
      serve("m1", "Ada", "s1", "2026-04-05"),
      serve("m1", "Ada", "s2", "2026-04-12"),
      serve("m2", "Bo", "s1", "2026-04-05"),
    ];
    const r = buildVolunteerBalance(rows, FROM, TO);
    expect(r.lines.map((l) => l.name)).toEqual(["Ada", "Bo"]);
    expect(r.lines[0]).toMatchObject({ serves: 2, services: 2 });
    expect(r.totals).toMatchObject({ serves: 3, activeVolunteers: 2, averageServes: 1.5 });
  });

  it("computes expected serves + delta from a personal target × months", () => {
    const rows = [serve("m1", "Ada", "s1", "2026-04-05", 2)]; // target 2/mo × 3 = 6 expected
    const r = buildVolunteerBalance(rows, FROM, TO);
    expect(r.months).toBe(3);
    expect(r.lines[0]).toMatchObject({ expectedServes: 6, delta: -5 });
  });

  it("falls back to the church default target", () => {
    const rows = [serve("m1", "Ada", "s1", "2026-04-05", null)];
    const r = buildVolunteerBalance(rows, FROM, TO, 1); // default 1/mo × 3 = 3
    expect(r.lines[0]).toMatchObject({ expectedServes: 3, delta: -2 });
  });

  it("leaves delta null when no target is known", () => {
    const r = buildVolunteerBalance([serve("m1", "Ada", "s1", "2026-04-05")], FROM, TO);
    expect(r.lines[0].delta).toBeNull();
  });

  it("excludes serves outside the range", () => {
    const rows = [serve("m1", "Ada", "s1", "2026-03-30"), serve("m1", "Ada", "s2", "2026-04-05")];
    expect(buildVolunteerBalance(rows, FROM, TO).lines[0].serves).toBe(1);
  });
});

function req(serviceId: string, name: string, date: string, roleId: string, role: string, required: number, filled: number): CoverageRow {
  return { serviceId, serviceName: name, serviceDateLocal: `${date}T10:00:00Z`, roleId, roleName: role, required, filled };
}

describe("buildServiceCoverage", () => {
  it("sums slots and surfaces gaps per service", () => {
    const rows = [
      req("s1", "Sun AM", "2026-04-05", "r1", "Vocals", 2, 1),
      req("s1", "Sun AM", "2026-04-05", "r2", "Sound", 1, 1),
    ];
    const r = buildServiceCoverage(rows, FROM, TO);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ requiredSlots: 3, filledSlots: 2 });
    expect(r.lines[0].coverage).toBeCloseTo(2 / 3);
    expect(r.lines[0].gaps).toEqual([{ roleId: "r1", role: "Vocals", missing: 1 }]);
  });

  it("caps filled at required so overfill never exceeds 100%", () => {
    const r = buildServiceCoverage([req("s1", "Sun", "2026-04-05", "r1", "Vocals", 1, 3)], FROM, TO);
    expect(r.lines[0].coverage).toBe(1);
    expect(r.lines[0].filledSlots).toBe(1);
    expect(r.lines[0].gaps).toEqual([]);
  });

  it("aggregates totals across services and counts gap-free ones", () => {
    const rows = [
      req("s1", "A", "2026-04-05", "r1", "Vocals", 2, 2),
      req("s2", "B", "2026-04-12", "r1", "Vocals", 2, 0),
    ];
    const r = buildServiceCoverage(rows, FROM, TO);
    expect(r.totals).toMatchObject({
      requiredSlots: 4,
      filledSlots: 2,
      fullyCovered: 1,
      servicesWithGaps: 1,
    });
    expect(r.totals.coverage).toBeCloseTo(0.5);
    // soonest first
    expect(r.lines.map((l) => l.name)).toEqual(["A", "B"]);
  });
});
