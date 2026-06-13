import { describe, expect, it } from "vitest";
import { freeSlots, parseTimeToMinutes } from "./slots";
import { parseTstzRange, dueBookingReminders } from "./data/booking";
import type { Booking } from "@/src/types/booking";

const DAY = 86_400_000;
// 2026-06-15 is a Monday (UTC). Pin everything to UTC for determinism.
const MON = Date.parse("2026-06-15T00:00:00.000Z");

describe("parseTimeToMinutes", () => {
  it("parses HH:MM and HH:MM:SS", () => {
    expect(parseTimeToMinutes("09:00")).toBe(540);
    expect(parseTimeToMinutes("09:30:00")).toBe(570);
    expect(parseTimeToMinutes("23:59")).toBe(1439);
  });
  it("rejects malformed times", () => {
    expect(parseTimeToMinutes("24:00")).toBe(null);
    expect(parseTimeToMinutes("9")).toBe(null);
    expect(parseTimeToMinutes("ab:cd")).toBe(null);
  });
});

describe("freeSlots", () => {
  const monday = { weekday: 1, start_time: "09:00", end_time: "12:00" };

  it("slices a window into fixed-length slots", () => {
    const slots = freeSlots({
      windows: [monday],
      busy: [],
      slotMinutes: 60,
      fromMs: MON,
      toMs: MON + DAY,
      nowMs: 0,
    });
    expect(slots).toHaveLength(3); // 09-10, 10-11, 11-12
    expect(slots[0].start).toBe("2026-06-15T09:00:00.000Z");
    expect(slots[2].end).toBe("2026-06-15T12:00:00.000Z");
  });

  it("only emits slots on the matching weekday", () => {
    const slots = freeSlots({
      windows: [monday],
      busy: [],
      slotMinutes: 60,
      fromMs: MON + DAY, // Tuesday
      toMs: MON + 2 * DAY,
      nowMs: 0,
    });
    expect(slots).toEqual([]);
  });

  it("subtracts an approved booking (incl. buffers) from the window", () => {
    // Busy 10:00–11:00 → the 10–11 slot is removed; 09–10 and 11–12 remain.
    const slots = freeSlots({
      windows: [monday],
      busy: [
        {
          startMs: Date.parse("2026-06-15T10:00:00Z"),
          endMs: Date.parse("2026-06-15T11:00:00Z"),
        },
      ],
      slotMinutes: 60,
      fromMs: MON,
      toMs: MON + DAY,
      nowMs: 0,
    });
    expect(slots.map((s) => s.start)).toEqual([
      "2026-06-15T09:00:00.000Z",
      "2026-06-15T11:00:00.000Z",
    ]);
  });

  it("drops slots starting at or before now", () => {
    const slots = freeSlots({
      windows: [monday],
      busy: [],
      slotMinutes: 60,
      fromMs: MON,
      toMs: MON + DAY,
      nowMs: Date.parse("2026-06-15T09:30:00Z"), // past the 09:00 slot start
    });
    // 09:00 slot starts before now → dropped; 10 + 11 remain.
    expect(slots.map((s) => s.start)).toEqual([
      "2026-06-15T10:00:00.000Z",
      "2026-06-15T11:00:00.000Z",
    ]);
  });

  it("honours a custom step smaller than the slot", () => {
    const slots = freeSlots({
      windows: [{ weekday: 1, start_time: "09:00", end_time: "10:00" }],
      busy: [],
      slotMinutes: 30,
      stepMinutes: 30,
      fromMs: MON,
      toMs: MON + DAY,
      nowMs: 0,
    });
    expect(slots).toHaveLength(2);
  });

  it("returns [] for non-positive slot length or inverted range", () => {
    expect(
      freeSlots({ windows: [monday], busy: [], slotMinutes: 0, fromMs: MON, toMs: MON + DAY }),
    ).toEqual([]);
    expect(
      freeSlots({ windows: [monday], busy: [], slotMinutes: 60, fromMs: MON + DAY, toMs: MON }),
    ).toEqual([]);
  });
});

describe("parseTstzRange", () => {
  it("parses a PostgREST tstzrange with [) bounds", () => {
    const r = parseTstzRange('["2026-06-15 09:00:00+00","2026-06-15 10:00:00+00")');
    expect(r).not.toBeNull();
    expect(r!.startMs).toBe(Date.parse("2026-06-15T09:00:00Z"));
    expect(r!.endMs).toBe(Date.parse("2026-06-15T10:00:00Z"));
  });
  it("returns null for malformed input", () => {
    expect(parseTstzRange("")).toBeNull();
    expect(parseTstzRange("[only-one)")).toBeNull();
  });
});

describe("dueBookingReminders", () => {
  const base = (over: Partial<Booking>): Pick<
    Booking,
    "id" | "church_id" | "title" | "starts_at_utc" | "renter_contact" | "status"
  > => ({
    id: "b1",
    church_id: "c1",
    title: "Wedding",
    starts_at_utc: "2026-06-16T10:00:00Z",
    renter_contact: "renter@example.com",
    status: "approved",
    ...over,
  });

  it("returns approved bookings whose start is the day before", () => {
    const now = new Date("2026-06-15T10:00:00Z");
    const out = dueBookingReminders([base({})], now, [1]);
    expect(out).toHaveLength(1);
    expect(out[0].days_until).toBe(1);
  });

  it("skips non-approved and out-of-window bookings", () => {
    const now = new Date("2026-06-15T10:00:00Z");
    expect(dueBookingReminders([base({ status: "pending" })], now, [1])).toEqual([]);
    expect(
      dueBookingReminders([base({ starts_at_utc: "2026-06-20T10:00:00Z" })], now, [1]),
    ).toEqual([]);
  });
});
