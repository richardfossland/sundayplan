import { describe, expect, it } from "vitest";
import {
  addDays,
  addMinutesLocal,
  alternativesToChips,
  blockIntersectsDay,
  bookingColor,
  conflictWindows,
  effectiveBlock,
  fromLocalInput,
  monthGridDays,
  placeInDay,
  startOfWeek,
  toLocalInput,
  viewRange,
  weekDays,
} from "./calendar";
import type { RequestBookingResult } from "@/src/types/booking";

describe("week/month grid math", () => {
  it("startOfWeek snaps to the Monday 00:00 of the week", () => {
    // 2026-06-13 is a Saturday.
    const sat = new Date(2026, 5, 13, 15, 30);
    const mon = startOfWeek(sat);
    expect(mon.getDay()).toBe(1); // Monday
    expect(mon.getDate()).toBe(8);
    expect(mon.getHours()).toBe(0);
    expect(mon.getMinutes()).toBe(0);
  });

  it("startOfWeek treats Sunday as the last day of the prior week", () => {
    const sun = new Date(2026, 5, 14, 9, 0); // Sunday
    const mon = startOfWeek(sun);
    expect(mon.getDay()).toBe(1);
    expect(mon.getDate()).toBe(8);
  });

  it("weekDays returns 7 consecutive Mon..Sun anchors", () => {
    const days = weekDays(new Date(2026, 5, 13));
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(1);
    expect(days[6].getDay()).toBe(0);
    expect(days[1].getTime() - days[0].getTime()).toBe(86_400_000);
  });

  it("monthGridDays returns a 6x7 grid starting on a Monday", () => {
    const grid = monthGridDays(new Date(2026, 5, 13));
    expect(grid).toHaveLength(42);
    expect(grid[0].getDay()).toBe(1);
    // The 1st of the month must be inside the grid.
    expect(grid.some((d) => d.getDate() === 1 && d.getMonth() === 5)).toBe(true);
  });

  it("viewRange spans exactly 7 days for week, 42 for month", () => {
    const anchor = new Date(2026, 5, 13);
    const wk = viewRange("week", anchor);
    const days = (Date.parse(wk.to) - Date.parse(wk.from)) / 86_400_000;
    expect(days).toBe(7);
    const mo = viewRange("month", anchor);
    const mdays = (Date.parse(mo.to) - Date.parse(mo.from)) / 86_400_000;
    expect(mdays).toBe(42);
  });
});

describe("effectiveBlock", () => {
  it("extends the core time by setup before and teardown after", () => {
    const blk = effectiveBlock({
      starts_at_utc: "2026-06-13T10:00:00.000Z",
      ends_at_utc: "2026-06-13T11:00:00.000Z",
      setup_min: 30,
      teardown_min: 15,
    });
    expect(blk.coreStart).toBe(Date.parse("2026-06-13T10:00:00.000Z"));
    expect(blk.coreEnd).toBe(Date.parse("2026-06-13T11:00:00.000Z"));
    expect(blk.blockStart).toBe(Date.parse("2026-06-13T09:30:00.000Z"));
    expect(blk.blockEnd).toBe(Date.parse("2026-06-13T11:15:00.000Z"));
  });

  it("with zero buffers the block equals the core", () => {
    const blk = effectiveBlock({
      starts_at_utc: "2026-06-13T10:00:00.000Z",
      ends_at_utc: "2026-06-13T11:00:00.000Z",
      setup_min: 0,
      teardown_min: 0,
    });
    expect(blk.blockStart).toBe(blk.coreStart);
    expect(blk.blockEnd).toBe(blk.coreEnd);
  });
});

describe("placeInDay / blockIntersectsDay", () => {
  it("places a midday span at the right vertical fraction", () => {
    const day = new Date(2026, 5, 13, 0, 0, 0, 0);
    const start = new Date(2026, 5, 13, 6, 0).getTime(); // 25% of day
    const end = new Date(2026, 5, 13, 12, 0).getTime(); // 50% of day
    const p = placeInDay(start, end, day);
    expect(p.topPct).toBeCloseTo(25, 5);
    expect(p.heightPct).toBeCloseTo(25, 5);
    expect(p.clippedTop).toBe(false);
    expect(p.clippedBottom).toBe(false);
  });

  it("clips a span crossing midnight to the day boundaries", () => {
    const day = new Date(2026, 5, 13, 0, 0, 0, 0);
    const start = new Date(2026, 5, 12, 22, 0).getTime(); // prior day
    const end = new Date(2026, 5, 13, 2, 0).getTime();
    const p = placeInDay(start, end, day);
    expect(p.topPct).toBe(0);
    expect(p.clippedTop).toBe(true);
    expect(p.heightPct).toBeCloseTo((2 / 24) * 100, 5);
  });

  it("blockIntersectsDay is false for a block on another day", () => {
    const blk = effectiveBlock({
      starts_at_utc: new Date(2026, 5, 14, 10, 0).toISOString(),
      ends_at_utc: new Date(2026, 5, 14, 11, 0).toISOString(),
      setup_min: 0,
      teardown_min: 0,
    });
    expect(blockIntersectsDay(blk, new Date(2026, 5, 13))).toBe(false);
    expect(blockIntersectsDay(blk, new Date(2026, 5, 14))).toBe(true);
  });
});

describe("bookingColor", () => {
  it("prefers the event_type color", () => {
    const c = bookingColor(
      { event_type_id: "et1" },
      {
        eventTypeColors: { et1: "#ff0000" },
        resourceColors: { r1: "#00ff00" },
        primaryResourceId: "r1",
      },
    );
    expect(c).toBe("#ff0000");
  });

  it("falls back to resource color, then the default", () => {
    expect(
      bookingColor(
        { event_type_id: null },
        { eventTypeColors: {}, resourceColors: { r1: "#00ff00" }, primaryResourceId: "r1" },
      ),
    ).toBe("#00ff00");
    expect(
      bookingColor(
        { event_type_id: null },
        { eventTypeColors: {}, fallback: "#abcabc" },
      ),
    ).toBe("#abcabc");
  });
});

describe("alternativesToChips", () => {
  it("flattens a 409 result into one chip per window", () => {
    const result: RequestBookingResult = {
      ok: false,
      conflicts: [{ resource_id: "r1", conflicts: [] }],
      alternatives: [
        {
          resource_id: "r1",
          windows: [
            { starts: "2026-06-13T12:00:00Z", ends: "2026-06-13T13:00:00Z" },
            { starts: "2026-06-13T14:00:00Z", ends: "2026-06-13T15:00:00Z" },
          ],
        },
      ],
    };
    const chips = alternativesToChips(result, (id) => (id === "r1" ? "Main hall" : id));
    expect(chips).toHaveLength(2);
    expect(chips[0]).toMatchObject({
      resourceId: "r1",
      resourceName: "Main hall",
      starts: "2026-06-13T12:00:00Z",
    });
    expect(new Set(chips.map((c) => c.key)).size).toBe(2); // keys unique
  });

  it("returns [] for a successful result or null", () => {
    expect(
      alternativesToChips(
        { ok: true, booking_id: "b1", status: "approved" },
        (id) => id,
      ),
    ).toEqual([]);
    expect(alternativesToChips(null, (id) => id)).toEqual([]);
    expect(
      alternativesToChips({ ok: false, conflict: true }, (id) => id),
    ).toEqual([]);
  });

  it("conflictWindows flattens the per-resource conflict ranges", () => {
    const result: RequestBookingResult = {
      ok: false,
      conflicts: [
        {
          resource_id: "r1",
          conflicts: [
            {
              booking_id: "b9",
              range: { starts: "2026-06-13T10:00:00Z", ends: "2026-06-13T11:00:00Z" },
            },
          ],
        },
      ],
      alternatives: [],
    };
    const windows = conflictWindows(result);
    expect(windows).toHaveLength(1);
    expect(windows[0].resourceId).toBe("r1");
    expect(windows[0].window.starts).toBe("2026-06-13T10:00:00Z");
  });
});

describe("datetime-local helpers", () => {
  it("toLocalInput/fromLocalInput round-trip a local wall-clock time", () => {
    const local = "2026-06-13T10:30";
    const iso = fromLocalInput(local);
    expect(toLocalInput(iso)).toBe(local);
  });

  it("addMinutesLocal advances the wall clock and rolls the hour", () => {
    expect(addMinutesLocal("2026-06-13T10:30", 90)).toBe("2026-06-13T12:00");
  });

  it("addDays advances by whole local days", () => {
    const d = addDays(new Date(2026, 5, 13), 3);
    expect(d.getDate()).toBe(16);
  });
});
