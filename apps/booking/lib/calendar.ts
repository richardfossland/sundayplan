/**
 * Pure, network-free calendar + conflict helpers. Everything here is
 * deterministic and unit-tested (lib/calendar.test.ts) — no Supabase, no React,
 * no Date.now() inside the exported math (callers pass an anchor).
 *
 * Times are handled as ISO-8601 strings / epoch ms. Grid math operates in the
 * browser's local timezone via the Date object (a church views its own
 * calendar in its own clock); UTC strings come straight from the DB.
 */
import type {
  Booking,
  ConflictWindow,
  RequestBookingResult,
  Resource,
  ResourceAlternatives,
} from "@/src/types/booking";

export type CalendarView = "week" | "month";

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

// ── Day / week boundaries (local time, Monday-first like Norway) ──────────────

/** Midnight (local) at the start of the given day. */
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Monday 00:00 (local) of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const dow = x.getDay(); // 0=Sun..6=Sat
  const diff = (dow + 6) % 7; // days since Monday
  x.setDate(x.getDate() - diff);
  return x;
}

/** First cell of the month grid: the Monday on/just-before the 1st. */
export function startOfMonthGrid(d: Date): Date {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return startOfWeek(first);
}

/** The 7 day-anchors (Mon..Sun) for the week containing `d`. */
export function weekDays(d: Date): Date[] {
  const start = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** The 42 day-anchors (6 weeks) of the month grid containing `d`. */
export function monthGridDays(d: Date): Date[] {
  const start = startOfMonthGrid(d);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Visible [from, to) ISO range to fetch for a view anchored at `anchor`. */
export function viewRange(view: CalendarView, anchor: Date): { from: string; to: string } {
  if (view === "week") {
    const from = startOfWeek(anchor);
    return { from: from.toISOString(), to: addDays(from, 7).toISOString() };
  }
  const from = startOfMonthGrid(anchor);
  return { from: from.toISOString(), to: addDays(from, 42).toISOString() };
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// ── Effective block (setup/teardown buffers) ─────────────────────────────────

export interface EffectiveBlock {
  /** Core start (ms epoch). */
  coreStart: number;
  coreEnd: number;
  /** Setup buffer extends before core; teardown after. */
  blockStart: number;
  blockEnd: number;
  setupMin: number;
  teardownMin: number;
}

/**
 * Compute the buffered (effective) block for a booking — what actually holds
 * the resource — distinct from the core (visible event) time. Mirrors the SQL
 * `effective_range`.
 */
export function effectiveBlock(b: {
  starts_at_utc: string;
  ends_at_utc: string;
  setup_min: number;
  teardown_min: number;
}): EffectiveBlock {
  const coreStart = Date.parse(b.starts_at_utc);
  const coreEnd = Date.parse(b.ends_at_utc);
  return {
    coreStart,
    coreEnd,
    blockStart: coreStart - b.setup_min * MS_PER_MIN,
    blockEnd: coreEnd + b.teardown_min * MS_PER_MIN,
    setupMin: b.setup_min,
    teardownMin: b.teardown_min,
  };
}

// ── Day-column geometry (week view) ───────────────────────────────────────────

/** Vertical placement of a span within a single day column, as percentages. */
export interface DayPlacement {
  /** % from the top of the day (0..100). */
  topPct: number;
  /** % height (clamped so it stays inside the day). */
  heightPct: number;
  /** True when the span is clipped at the top/bottom day boundary. */
  clippedTop: boolean;
  clippedBottom: boolean;
}

/**
 * Where a [startMs,endMs) span sits inside the local day `dayStart`, as
 * percentages of a 24h column. Spans crossing midnight are clipped to the day.
 */
export function placeInDay(
  startMs: number,
  endMs: number,
  dayStart: Date,
): DayPlacement {
  const dayStartMs = startOfDay(dayStart).getTime();
  const dayEndMs = dayStartMs + MS_PER_DAY;
  const s = Math.max(startMs, dayStartMs);
  const e = Math.min(endMs, dayEndMs);
  const topPct = ((s - dayStartMs) / MS_PER_DAY) * 100;
  const heightPct = Math.max(0, ((e - s) / MS_PER_DAY) * 100);
  return {
    topPct,
    heightPct,
    clippedTop: startMs < dayStartMs,
    clippedBottom: endMs > dayEndMs,
  };
}

/** Does a booking (its effective block) intersect the local day? */
export function blockIntersectsDay(block: EffectiveBlock, day: Date): boolean {
  const dayStartMs = startOfDay(day).getTime();
  const dayEndMs = dayStartMs + MS_PER_DAY;
  return block.blockStart < dayEndMs && block.blockEnd > dayStartMs;
}

// ── Color resolution (event_type wins, else resource, else fallback) ─────────

export function bookingColor(
  b: Pick<Booking, "event_type_id">,
  opts: {
    eventTypeColors: Record<string, string | null>;
    resourceColors?: Record<string, string | null>;
    primaryResourceId?: string | null;
    fallback?: string;
  },
): string {
  const fallback = opts.fallback ?? "#6366f1";
  if (b.event_type_id && opts.eventTypeColors[b.event_type_id]) {
    return opts.eventTypeColors[b.event_type_id]!;
  }
  if (
    opts.primaryResourceId &&
    opts.resourceColors?.[opts.primaryResourceId]
  ) {
    return opts.resourceColors[opts.primaryResourceId]!;
  }
  return fallback;
}

// ── 409 conflict → alternative chips ──────────────────────────────────────────

export interface AlternativeChip {
  resourceId: string;
  resourceName: string;
  starts: string;
  ends: string;
  /** Stable key for React lists. */
  key: string;
}

/**
 * Flatten a 409 `request_booking` result's `alternatives` into clickable chips.
 * Returns [] for any other result shape (success / generic conflict), so the UI
 * can render unconditionally. Resource names resolved from the lookup map.
 */
export function alternativesToChips(
  result: RequestBookingResult | null | undefined,
  resourceName: (id: string) => string,
): AlternativeChip[] {
  if (!result || result.ok) return [];
  if (!("alternatives" in result) || !Array.isArray(result.alternatives)) {
    return [];
  }
  const chips: AlternativeChip[] = [];
  for (const alt of result.alternatives as ResourceAlternatives[]) {
    for (let i = 0; i < (alt.windows ?? []).length; i++) {
      const w = alt.windows[i];
      chips.push({
        resourceId: alt.resource_id,
        resourceName: resourceName(alt.resource_id),
        starts: w.starts,
        ends: w.ends,
        key: `${alt.resource_id}:${w.starts}:${i}`,
      });
    }
  }
  return chips;
}

/** Flatten the conflict windows from a 409 for inline display. */
export function conflictWindows(
  result: RequestBookingResult | null | undefined,
): { resourceId: string; window: ConflictWindow }[] {
  if (!result || result.ok || !("conflicts" in result)) return [];
  const out: { resourceId: string; window: ConflictWindow }[] = [];
  for (const c of result.conflicts) {
    for (const item of c.conflicts ?? []) {
      out.push({ resourceId: c.resource_id, window: item.range });
    }
  }
  return out;
}

// ── datetime-local <-> ISO helpers (form binding) ─────────────────────────────

/** `YYYY-MM-DDTHH:mm` in LOCAL time, for an <input type="datetime-local">. */
export function toLocalInput(iso: string | number | Date): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** Parse a local datetime-local string back to a UTC ISO string. */
export function fromLocalInput(local: string): string {
  // `new Date('YYYY-MM-DDTHH:mm')` is interpreted as local time.
  return new Date(local).toISOString();
}

/** Add minutes to a local datetime-local string, return a local string. */
export function addMinutesLocal(local: string, minutes: number): string {
  const d = new Date(local);
  d.setMinutes(d.getMinutes() + minutes);
  return toLocalInput(d);
}

// ── resource lookup helper ────────────────────────────────────────────────────

export function resourceNameLookup(resources: Resource[]): (id: string) => string {
  const map = new Map(resources.map((r) => [r.id, r.name]));
  return (id) => map.get(id) ?? id;
}
