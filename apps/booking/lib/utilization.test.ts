import { describe, it, expect } from "vitest";
import {
  occupancyByResource,
  busiestHours,
  hoursByWeek,
  isoWeekKey,
  summarize,
  type UtilBlock,
} from "./utilization";

const H = 3_600_000;
// A fixed local-time window: 1 day = 24h, openHours default 16.
const day0 = new Date(2026, 5, 1, 0, 0, 0, 0).getTime(); // 1 Jun 2026 local midnight

function at(dayOffset: number, hour: number): number {
  return new Date(2026, 5, 1 + dayOffset, hour, 0, 0, 0).getTime();
}

describe("occupancyByResource", () => {
  it("computes booked/available hours and occupancy %", () => {
    const blocks: UtilBlock[] = [
      { resourceId: "r1", startMs: at(0, 10), endMs: at(0, 14) }, // 4h
      { resourceId: "r1", startMs: at(0, 18), endMs: at(0, 20) }, // 2h
    ];
    const occ = occupancyByResource({
      blocks,
      resourceIds: ["r1", "r2"],
      fromMs: day0,
      toMs: day0 + 24 * H,
      openHoursPerDay: 16,
    });
    const r1 = occ.find((o) => o.resourceId === "r1")!;
    expect(r1.bookedHours).toBe(6);
    expect(r1.availableHours).toBe(16);
    expect(r1.occupancyPct).toBe(37.5);
    expect(r1.freePct).toBe(62.5);
    // r2 has no bookings but still appears at 0%
    const r2 = occ.find((o) => o.resourceId === "r2")!;
    expect(r2.bookedHours).toBe(0);
    expect(r2.occupancyPct).toBe(0);
    expect(r2.freePct).toBe(100);
  });

  it("clips blocks to the window", () => {
    const blocks: UtilBlock[] = [
      { resourceId: "r1", startMs: at(0, 22), endMs: at(1, 2) }, // spans midnight
    ];
    const occ = occupancyByResource({
      blocks,
      resourceIds: ["r1"],
      fromMs: day0,
      toMs: day0 + 24 * H, // only the first day
      openHoursPerDay: 16,
    });
    // only 22:00–24:00 = 2h falls in-window
    expect(occ[0].bookedHours).toBe(2);
  });

  it("clamps occupancy at 100%", () => {
    const blocks: UtilBlock[] = [
      { resourceId: "r1", startMs: at(0, 0), endMs: at(0, 24) }, // 24h booked, 16 available
    ];
    const occ = occupancyByResource({
      blocks,
      resourceIds: ["r1"],
      fromMs: day0,
      toMs: day0 + 24 * H,
      openHoursPerDay: 16,
    });
    expect(occ[0].occupancyPct).toBe(100);
    expect(occ[0].freePct).toBe(0);
  });
});

describe("busiestHours", () => {
  it("buckets booked hours by hour-of-day, splitting multi-hour blocks", () => {
    const blocks: UtilBlock[] = [
      { resourceId: "r1", startMs: at(0, 10), endMs: at(0, 12) }, // 10:00,11:00
      { resourceId: "r2", startMs: at(0, 10), endMs: at(0, 11) }, // 10:00
    ];
    const buckets = busiestHours(blocks, day0, day0 + 24 * H);
    expect(buckets[10]).toBe(2); // 1h + 1h
    expect(buckets[11]).toBe(1);
    expect(buckets[9]).toBe(0);
  });
});

describe("hoursByWeek", () => {
  it("groups booked hours by ISO week", () => {
    const blocks: UtilBlock[] = [
      { resourceId: "r1", startMs: at(0, 10), endMs: at(0, 12) }, // 1 Jun (Mon) wk23
      { resourceId: "r1", startMs: at(7, 10), endMs: at(7, 13) }, // 8 Jun (Mon) wk24
    ];
    const weeks = hoursByWeek(blocks, day0, day0 + 60 * 24 * H);
    expect(weeks.length).toBe(2);
    expect(weeks[0].bookedHours).toBe(2);
    expect(weeks[1].bookedHours).toBe(3);
    expect(weeks[0].week < weeks[1].week).toBe(true);
  });
});

describe("isoWeekKey", () => {
  it("computes the ISO week for a known date", () => {
    // 1 Jun 2026 is a Monday in ISO week 23.
    expect(isoWeekKey(new Date(2026, 5, 1))).toBe("2026-W23");
  });
});

describe("summarize", () => {
  it("rolls up average occupancy, totals, external count and peak hour", () => {
    const blocks: UtilBlock[] = [
      { resourceId: "r1", startMs: at(0, 10), endMs: at(0, 14), isExternal: true },
      { resourceId: "r2", startMs: at(0, 10), endMs: at(0, 12) },
    ];
    const occ = occupancyByResource({
      blocks,
      resourceIds: ["r1", "r2"],
      fromMs: day0,
      toMs: day0 + 24 * H,
      openHoursPerDay: 16,
    });
    const s = summarize(occ, blocks, day0, day0 + 24 * H);
    expect(s.totalBookedHours).toBe(6);
    expect(s.externalCount).toBe(1);
    expect(s.peakHour).toBe(10);
    expect(s.avgOccupancyPct).toBeGreaterThan(0);
  });
});
