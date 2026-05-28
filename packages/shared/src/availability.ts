/**
 * Availability coverage — the single source of truth for "is this member
 * blocked on this date?". Used by the scoring engine (hard gate) and the
 * conflict engine (rule: assigned during declared unavailability).
 *
 * All date reasoning is UTC-based. A service's local wall-clock day is not
 * relevant here — availability is expressed as calendar dates/weekdays and we
 * compare against the service's UTC date. (If a church ever needs local-day
 * semantics, normalize the Date before calling.)
 */

import type { Availability } from "./types";

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/** ISO `YYYY-MM-DD` for the UTC date of `d`. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Lowercase English weekday name for the UTC date of `d`. */
export function utcWeekday(d: Date): string {
  return WEEKDAYS[d.getUTCDay()];
}

/** True if a single availability record blocks `date`. */
export function availabilityCovers(av: Availability, date: Date): boolean {
  const iso = isoDate(date);
  const p = av.pattern as Record<string, unknown>;

  if (av.kind === "specific" && Array.isArray(p.dates)) {
    return (p.dates as string[]).includes(iso);
  }
  if (av.kind === "range" && typeof p.from === "string" && typeof p.to === "string") {
    return iso >= p.from && iso <= p.to;
  }
  if (av.kind === "recurring" && typeof p.weekday === "string") {
    return p.weekday === utcWeekday(date);
  }
  return false;
}

/** True if ANY of the member's availability records block `date`. */
export function isUnavailable(records: Availability[], date: Date): boolean {
  return records.some((av) => availabilityCovers(av, date));
}
