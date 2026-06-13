/**
 * Pure, network-free utilization/occupancy aggregations for the planner
 * dashboard (Phase 4, feature 4). Deterministic + unit-tested
 * (lib/utilization.test.ts) — no Supabase, no Date.now() in the exported math.
 *
 * Occupancy % = booked hours / available hours within a window. "Available" is
 * derived from a daily opening-hours assumption (configurable) so a church
 * without per-resource availability rows still gets a sane denominator. Busiest
 * times bucket booked hours by hour-of-day. Grouping is by resource and by
 * ISO-week so the UI can render simple CSS/SVG bars.
 */

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** A booked block on a single resource (core or effective time, caller's choice). */
export interface UtilBlock {
  resourceId: string;
  /** epoch ms. */
  startMs: number;
  endMs: number;
  /** Optional: count toward external-rental / no-show tallies. */
  isExternal?: boolean;
  status?: string;
}

export interface OccupancyInput {
  blocks: UtilBlock[];
  /** Resource ids to report (so a 0%-used resource still appears). */
  resourceIds: string[];
  /** Window [fromMs, toMs). */
  fromMs: number;
  toMs: number;
  /** Open hours per day used for the denominator (default 07:00–23:00 = 16h). */
  openHoursPerDay?: number;
}

export interface ResourceOccupancy {
  resourceId: string;
  bookedHours: number;
  availableHours: number;
  /** 0..100, clamped. */
  occupancyPct: number;
  /** 100 - occupancyPct, clamped (the "ledig %"). */
  freePct: number;
}

/** Clip a block to [fromMs,toMs) and return its duration in hours (>=0). */
function clippedHours(b: UtilBlock, fromMs: number, toMs: number): number {
  const s = Math.max(b.startMs, fromMs);
  const e = Math.min(b.endMs, toMs);
  return e > s ? (e - s) / MS_PER_HOUR : 0;
}

/** Whole+fractional days spanned by [fromMs,toMs). */
function windowDays(fromMs: number, toMs: number): number {
  return Math.max(0, (toMs - fromMs) / MS_PER_DAY);
}

/**
 * Booked vs available hours and occupancy % per resource over the window.
 * Booked hours are summed from (clipped) blocks; available = days × openHours.
 */
export function occupancyByResource(input: OccupancyInput): ResourceOccupancy[] {
  const openHours = input.openHoursPerDay ?? 16;
  const days = windowDays(input.fromMs, input.toMs);
  const available = days * openHours;

  const booked = new Map<string, number>();
  for (const id of input.resourceIds) booked.set(id, 0);
  for (const b of input.blocks) {
    if (!booked.has(b.resourceId)) continue;
    booked.set(b.resourceId, booked.get(b.resourceId)! + clippedHours(b, input.fromMs, input.toMs));
  }

  return input.resourceIds.map((id) => {
    const bookedHours = round1(booked.get(id) ?? 0);
    const occupancyPct =
      available > 0 ? clampPct((bookedHours / available) * 100) : 0;
    return {
      resourceId: id,
      bookedHours,
      availableHours: round1(available),
      occupancyPct: round1(occupancyPct),
      freePct: round1(clampPct(100 - occupancyPct)),
    };
  });
}

/** Booked hours bucketed by local hour-of-day (0..23) across all blocks. */
export function busiestHours(
  blocks: UtilBlock[],
  fromMs: number,
  toMs: number,
): number[] {
  const buckets = new Array(24).fill(0) as number[];
  for (const b of blocks) {
    const s = Math.max(b.startMs, fromMs);
    const e = Math.min(b.endMs, toMs);
    if (e <= s) continue;
    // Walk hour-aligned segments so a block spanning multiple hours credits each.
    let cur = s;
    while (cur < e) {
      const d = new Date(cur);
      const hour = d.getHours();
      const nextHour = new Date(cur);
      nextHour.setMinutes(60, 0, 0);
      const segEnd = Math.min(e, nextHour.getTime());
      buckets[hour] += (segEnd - cur) / MS_PER_HOUR;
      cur = segEnd;
    }
  }
  return buckets.map(round1);
}

export interface WeekBucket {
  /** ISO week key `YYYY-Www` (local). */
  week: string;
  bookedHours: number;
}

/** Booked hours grouped by ISO week (local time). */
export function hoursByWeek(
  blocks: UtilBlock[],
  fromMs: number,
  toMs: number,
): WeekBucket[] {
  const map = new Map<string, number>();
  for (const b of blocks) {
    const hours = clippedHours(b, fromMs, toMs);
    if (hours <= 0) continue;
    const key = isoWeekKey(new Date(Math.max(b.startMs, fromMs)));
    map.set(key, (map.get(key) ?? 0) + hours);
  }
  return [...map.entries()]
    .map(([week, h]) => ({ week, bookedHours: round1(h) }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

/** `YYYY-Www` ISO-8601 week key for a local date. */
export function isoWeekKey(d: Date): string {
  // Copy + shift to Thursday of the current ISO week (week belongs to its Thu).
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (date.getDay() + 6) % 7; // 0=Mon..6=Sun
  date.setDate(date.getDate() - day + 3);
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  const firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3);
  const week =
    1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * MS_PER_DAY));
  return `${date.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface UtilizationSummary {
  /** Mean occupancy across the reported resources. */
  avgOccupancyPct: number;
  totalBookedHours: number;
  /** Count of external-rental blocks in the window. */
  externalCount: number;
  /** The busiest hour-of-day (0..23), or null when nothing is booked. */
  peakHour: number | null;
}

/** Roll the per-resource occupancy + raw blocks into headline numbers. */
export function summarize(
  occ: ResourceOccupancy[],
  blocks: UtilBlock[],
  fromMs: number,
  toMs: number,
): UtilizationSummary {
  const avg =
    occ.length > 0 ? occ.reduce((s, r) => s + r.occupancyPct, 0) / occ.length : 0;
  const totalBooked = occ.reduce((s, r) => s + r.bookedHours, 0);
  const external = blocks.filter(
    (b) => b.isExternal && clippedHours(b, fromMs, toMs) > 0,
  ).length;
  const hours = busiestHours(blocks, fromMs, toMs);
  let peakHour: number | null = null;
  let peakVal = 0;
  hours.forEach((v, h) => {
    if (v > peakVal) {
      peakVal = v;
      peakHour = h;
    }
  });
  return {
    avgOccupancyPct: round1(avg),
    totalBookedHours: round1(totalBooked),
    externalCount: external,
    peakHour,
  };
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
