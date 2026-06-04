import { describe, expect, it } from "vitest";
import {
  availabilityCovers,
  isUnavailable,
  isoDate,
  utcWeekday,
} from "./availability";
import type { Availability } from "./types";

function av(kind: Availability["kind"], pattern: Availability["pattern"]): Availability {
  return {
    id: `av-${kind}`,
    member_id: "m1",
    kind,
    pattern,
    reason: null,
    reason_visibility: "planner",
  };
}

// 2026-06-07 is a Sunday (UTC).
const SUNDAY = new Date("2026-06-07T10:00:00Z");
const MONDAY = new Date("2026-06-08T10:00:00Z");

describe("isoDate", () => {
  it("returns the UTC calendar date as YYYY-MM-DD", () => {
    expect(isoDate(new Date("2026-06-07T10:00:00Z"))).toBe("2026-06-07");
  });

  it("uses the UTC day, not local — late-UTC times do not roll forward", () => {
    expect(isoDate(new Date("2026-06-07T23:59:59Z"))).toBe("2026-06-07");
  });
});

describe("utcWeekday", () => {
  it("names the UTC weekday", () => {
    expect(utcWeekday(SUNDAY)).toBe("sunday");
    expect(utcWeekday(MONDAY)).toBe("monday");
  });

  it("is decided by the UTC instant, not local wall-clock", () => {
    // 2026-06-07T23:30Z is still Sunday in UTC even though it is past
    // midnight in any positive-offset timezone.
    expect(utcWeekday(new Date("2026-06-07T23:30:00Z"))).toBe("sunday");
  });
});

describe("availabilityCovers — specific dates", () => {
  it("blocks a listed date and only that date", () => {
    const rec = av("specific", { dates: ["2026-06-07", "2026-06-21"] });
    expect(availabilityCovers(rec, SUNDAY)).toBe(true);
    expect(availabilityCovers(rec, MONDAY)).toBe(false);
  });

  it("does not throw and returns false when dates is missing/malformed", () => {
    expect(availabilityCovers(av("specific", {}), SUNDAY)).toBe(false);
  });
});

describe("availabilityCovers — range from/to", () => {
  const rec = av("range", { from: "2026-06-01", to: "2026-06-10" });

  it("is inclusive of both endpoints", () => {
    expect(availabilityCovers(rec, new Date("2026-06-01T00:00:00Z"))).toBe(true);
    expect(availabilityCovers(rec, new Date("2026-06-10T23:00:00Z"))).toBe(true);
  });

  it("blocks dates strictly inside the range", () => {
    expect(availabilityCovers(rec, SUNDAY)).toBe(true);
  });

  it("does not block dates outside the range", () => {
    expect(availabilityCovers(rec, new Date("2026-05-31T12:00:00Z"))).toBe(false);
    expect(availabilityCovers(rec, new Date("2026-06-11T12:00:00Z"))).toBe(false);
  });

  it("returns false when from/to are missing", () => {
    expect(availabilityCovers(av("range", { from: "2026-06-01" }), SUNDAY)).toBe(false);
  });
});

describe("availabilityCovers — recurring weekday", () => {
  const rec = av("recurring", { weekday: "sunday" });

  it("blocks every matching weekday and nothing else", () => {
    expect(availabilityCovers(rec, SUNDAY)).toBe(true);
    expect(availabilityCovers(rec, new Date("2026-06-14T10:00:00Z"))).toBe(true); // next Sunday
    expect(availabilityCovers(rec, MONDAY)).toBe(false);
  });

  it("matches on the UTC weekday boundary", () => {
    // Still Sunday in UTC.
    expect(availabilityCovers(rec, new Date("2026-06-07T23:59:00Z"))).toBe(true);
    // Already Monday in UTC.
    expect(availabilityCovers(rec, new Date("2026-06-08T00:01:00Z"))).toBe(false);
  });

  it("returns false when weekday is missing", () => {
    expect(availabilityCovers(av("recurring", {}), SUNDAY)).toBe(false);
  });
});

describe("isUnavailable", () => {
  it("is true if ANY record covers the date", () => {
    const records: Availability[] = [
      av("recurring", { weekday: "saturday" }),
      av("specific", { dates: ["2026-06-07"] }),
    ];
    expect(isUnavailable(records, SUNDAY)).toBe(true);
  });

  it("is false when no record covers the date", () => {
    const records: Availability[] = [
      av("recurring", { weekday: "saturday" }),
      av("range", { from: "2026-07-01", to: "2026-07-31" }),
    ];
    expect(isUnavailable(records, SUNDAY)).toBe(false);
  });

  it("is false for an empty record set", () => {
    expect(isUnavailable([], SUNDAY)).toBe(false);
  });
});
