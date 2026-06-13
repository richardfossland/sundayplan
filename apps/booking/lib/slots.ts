/**
 * Pure, network-free appointment-slot derivation (Calendly-style picker for
 * `person` resources). Deterministic and unit-tested (lib/slots.test.ts) — no
 * Supabase, no React, no Date.now() inside the exported math.
 *
 * Free slots = the resource's weekly availability windows, projected onto each
 * day in a range, MINUS the time already held by approved bookings (incl. their
 * setup/teardown buffers, which the caller passes as effective ranges), then
 * sliced into fixed-length appointment slots.
 *
 * All instants are epoch-ms / ISO-8601 UTC. Availability `weekday`/`start_time`/
 * `end_time` describe a weekly window in UTC (the DB stores wall-clock time; we
 * treat it as UTC here so the math is timezone-stable and testable — the church
 * picks its own clock at display time). Keeping it UTC-pure means the same code
 * runs server-side and in tests with no TZ flakiness.
 */

export interface AvailabilityWindow {
  /** 0=Sunday … 6=Saturday (matches Date.getUTCDay()). */
  weekday: number;
  /** `HH:MM` or `HH:MM:SS` wall-clock, interpreted as UTC. */
  start_time: string;
  end_time: string;
}

/** A busy block already holding the resource (effective range, ms epoch). */
export interface BusyRange {
  startMs: number;
  endMs: number;
}

export interface FreeSlot {
  /** ISO-8601 UTC. */
  start: string;
  end: string;
}

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

/** Parse `HH:MM[:SS]` into minutes-since-midnight. Returns null if malformed. */
export function parseTimeToMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** UTC midnight (ms) of the day containing `ms`. */
function utcMidnight(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

/**
 * Derive bookable appointment slots in [fromMs, toMs).
 *
 * @param windows        weekly availability for the resource
 * @param busy           effective busy ranges (approved bookings + buffers)
 * @param slotMinutes    appointment length
 * @param fromMs/toMs    inclusive-start / exclusive-end search range (ms epoch)
 * @param nowMs          slots starting at/before this are dropped (past)
 * @param stepMinutes    spacing between candidate slot starts (default = slot)
 */
export function freeSlots(opts: {
  windows: AvailabilityWindow[];
  busy: BusyRange[];
  slotMinutes: number;
  fromMs: number;
  toMs: number;
  nowMs?: number;
  stepMinutes?: number;
}): FreeSlot[] {
  const { windows, busy, slotMinutes, fromMs, toMs } = opts;
  const nowMs = opts.nowMs ?? 0;
  const step = (opts.stepMinutes ?? slotMinutes) * MS_PER_MIN;
  const slotMs = slotMinutes * MS_PER_MIN;
  if (slotMinutes <= 0 || step <= 0 || toMs <= fromMs) return [];

  // Pre-sort busy ranges so the overlap check can early-exit.
  const busySorted = [...busy].sort((a, b) => a.startMs - b.startMs);
  const overlapsBusy = (s: number, e: number): boolean => {
    for (const b of busySorted) {
      if (b.startMs >= e) break; // sorted: nothing later can overlap
      if (b.endMs > s) return true;
    }
    return false;
  };

  const out: FreeSlot[] = [];
  // Walk each UTC day touched by the range.
  for (let day = utcMidnight(fromMs); day < toMs; day += MS_PER_DAY) {
    const weekday = new Date(day).getUTCDay();
    for (const w of windows) {
      if (w.weekday !== weekday) continue;
      const startMin = parseTimeToMinutes(w.start_time);
      const endMin = parseTimeToMinutes(w.end_time);
      if (startMin === null || endMin === null || endMin <= startMin) continue;

      const windowStart = day + startMin * MS_PER_MIN;
      const windowEnd = day + endMin * MS_PER_MIN;
      for (let s = windowStart; s + slotMs <= windowEnd; s += step) {
        const e = s + slotMs;
        if (s < fromMs || e > toMs) continue;
        if (s <= nowMs) continue; // no past slots
        if (overlapsBusy(s, e)) continue;
        out.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() });
      }
    }
  }
  // Days iterate ascending but windows within a day may be out of time order.
  out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return out;
}
