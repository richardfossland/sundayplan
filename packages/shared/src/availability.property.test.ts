/**
 * Property / invariant fuzz over the pure availability core.
 *
 * Deterministic: a fixed-seed mulberry32 PRNG drives all randomness. Iterations
 * are capped low. These pin invariants the fixture tests assert only at a few
 * hand-picked instants:
 *   • isoDate / utcWeekday depend ONLY on the UTC instant (DST-immune): two
 *     Dates with the same getTime() always agree.
 *   • range coverage: endpoints inclusive, strictly-outside excluded, and the
 *     covered set is exactly [from,to] for every probed day.
 *   • recurring coverage matches iff the UTC weekday name matches.
 */

import { describe, expect, it } from "vitest";
import { availabilityCovers, isoDate, utcWeekday } from "./availability";
import type { Availability } from "./types";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ITER = 400;
const DAY = 86_400_000;

function av(kind: Availability["kind"], pattern: Availability["pattern"]): Availability {
  return { id: "x", member_id: "m", kind, pattern, reason: null, reason_visibility: "planner" };
}

// random instant across ~80 years around the epoch boundary + future
function randInstant(rng: () => number): Date {
  const lo = Date.UTC(1960, 0, 1);
  const hi = Date.UTC(2060, 0, 1);
  return new Date(lo + Math.floor(rng() * (hi - lo)));
}

// ── 1. isoDate / utcWeekday depend only on the UTC instant ────────────────────
describe("isoDate / utcWeekday — property: UTC-instant determined", () => {
  it("equal getTime() ⇒ equal isoDate & weekday, regardless of how constructed", () => {
    const rng = mulberry32(0xa11ce);
    for (let i = 0; i < ITER; i++) {
      const t = randInstant(rng).getTime();
      const d1 = new Date(t);
      const d2 = new Date(t); // same instant, separate object
      expect(isoDate(d1)).toBe(isoDate(d2));
      expect(utcWeekday(d1)).toBe(utcWeekday(d2));
      // isoDate is always a well-formed YYYY-MM-DD
      expect(isoDate(d1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // weekday advances by 1 (mod 7) when we add exactly one UTC day
      const next = new Date(t + DAY);
      const order = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ];
      const expected = order[(order.indexOf(utcWeekday(d1)) + 1) % 7];
      expect(utcWeekday(next)).toBe(expected);
    }
  });
});

// ── 2. range coverage: exactly the inclusive [from,to] window ──────────────────
describe("availabilityCovers range — property", () => {
  it("covers a date iff from <= isoDate(date) <= to, endpoints inclusive", () => {
    const rng = mulberry32(0xdec0de);
    for (let i = 0; i < ITER; i++) {
      // pick an inclusive window
      const start = Date.UTC(2026, 0, 1) + Math.floor(rng() * 700) * DAY;
      const span = Math.floor(rng() * 30); // 0..30 day window
      const from = isoDate(new Date(start));
      const to = isoDate(new Date(start + span * DAY));
      const record = av("range", { from, to });

      // probe a day around the window
      const probeOffset = Math.floor(rng() * (span + 11)) - 5; // -5 .. span+5
      const probe = new Date(start + probeOffset * DAY);
      const iso = isoDate(probe);
      const expected = iso >= from && iso <= to;
      expect(availabilityCovers(record, probe)).toBe(expected);

      // endpoints are always inclusive
      expect(availabilityCovers(record, new Date(start))).toBe(true);
      expect(availabilityCovers(record, new Date(start + span * DAY))).toBe(true);
      // strictly outside is always excluded
      expect(availabilityCovers(record, new Date(start - DAY))).toBe(false);
      expect(availabilityCovers(record, new Date(start + (span + 1) * DAY))).toBe(false);
    }
  });
});

// ── 3. recurring coverage matches iff weekday name matches ────────────────────
describe("availabilityCovers recurring — property", () => {
  const NAMES = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  it("covers iff the record weekday equals utcWeekday(date)", () => {
    const rng = mulberry32(0x7eed);
    for (let i = 0; i < ITER; i++) {
      const weekday = NAMES[Math.floor(rng() * 7)];
      const record = av("recurring", { weekday });
      const date = randInstant(rng);
      expect(availabilityCovers(record, date)).toBe(weekday === utcWeekday(date));
    }
  });
});

// ── 4. specific dates: covers iff the iso date is listed ──────────────────────
describe("availabilityCovers specific — property", () => {
  it("covers iff isoDate(date) is in the list", () => {
    const rng = mulberry32(0x515751);
    for (let i = 0; i < ITER; i++) {
      const listed: string[] = [];
      const n = Math.floor(rng() * 4);
      for (let k = 0; k < n; k++) {
        listed.push(isoDate(new Date(Date.UTC(2026, 0, 1) + Math.floor(rng() * 400) * DAY)));
      }
      const record = av("specific", { dates: listed });
      const probe = new Date(Date.UTC(2026, 0, 1) + Math.floor(rng() * 400) * DAY);
      expect(availabilityCovers(record, probe)).toBe(listed.includes(isoDate(probe)));
    }
  });
});
