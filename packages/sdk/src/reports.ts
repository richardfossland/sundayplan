import type {
  SongUsageRow,
  TonoReport,
  TonoReportLine,
  CcliReport,
  CcliReportLine,
  UnregisteredSongLine,
} from "@sundayplan/shared";

/**
 * Phase 11 — pure licensing-usage report engine (TONO + CCLI).
 *
 * No I/O, no DB, no Date.now(): the data layer supplies normalized
 * {@link SongUsageRow} rows (one per song-played-in-a-service) and these pure
 * functions group, split, and serialize them.
 *
 * TONO nuance: streaming is a SEPARATE royalty pool, so every TONO line keeps
 * gathered vs streamed counts apart. Only songs with a `tonoWorkId` are
 * reportable to TONO; the rest are surfaced as `unregistered` (never dropped).
 * CCLI keys off `ccliNumber` and has no streaming-pool concept.
 */

/** Local wall-clock date portion (YYYY-MM-DD) of an ISO datetime string. */
function localDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Keep usages whose local service date is in `[from, to)` — `from` inclusive,
 * `to` exclusive. Bounds are compared on the YYYY-MM-DD date portion so a
 * "2026-07-01" upper bound excludes any service on that day.
 */
export function filterUsagesByRange(
  rows: SongUsageRow[],
  from: string,
  to: string,
): SongUsageRow[] {
  const fromDate = localDate(from);
  const toDate = localDate(to);
  return rows.filter((r) => {
    const d = localDate(r.serviceDateLocal);
    return d >= fromDate && d < toDate;
  });
}

function sortedDistinctDates(rows: SongUsageRow[]): string[] {
  const set = new Set(rows.map((r) => localDate(r.serviceDateLocal)));
  return [...set].sort();
}

function groupBySong(rows: SongUsageRow[]): Map<string, SongUsageRow[]> {
  const map = new Map<string, SongUsageRow[]>();
  for (const r of rows) {
    const list = map.get(r.songId);
    if (list) list.push(r);
    else map.set(r.songId, [r]);
  }
  return map;
}

function byTitle<T extends { title: string }>(a: T, b: T): number {
  return a.title.localeCompare(b.title);
}

/** Build a TONO usage report from raw usages, applying the date range first. */
export function buildTonoReport(
  rows: SongUsageRow[],
  from: string,
  to: string,
): TonoReport {
  const inRange = filterUsagesByRange(rows, from, to);
  const lines: TonoReportLine[] = [];
  const unregistered: UnregisteredSongLine[] = [];

  for (const [songId, group] of groupBySong(inRange)) {
    const first = group[0];
    if (first.tonoWorkId == null) {
      unregistered.push({ songId, title: first.title, totalPlays: group.length });
      continue;
    }
    const streamedPlays = group.filter((r) => r.wasStreamed).length;
    lines.push({
      songId,
      title: first.title,
      tonoWorkId: first.tonoWorkId,
      totalPlays: group.length,
      gatheredPlays: group.length - streamedPlays,
      streamedPlays,
      serviceDates: sortedDistinctDates(group),
    });
  }

  lines.sort(byTitle);
  unregistered.sort(byTitle);

  return {
    from,
    to,
    lines,
    unregistered,
    totals: {
      totalPlays: lines.reduce((n, l) => n + l.totalPlays, 0),
      gatheredPlays: lines.reduce((n, l) => n + l.gatheredPlays, 0),
      streamedPlays: lines.reduce((n, l) => n + l.streamedPlays, 0),
      reportableSongs: lines.length,
      unregisteredSongs: unregistered.length,
    },
  };
}

/** Build a CCLI usage report from raw usages, applying the date range first. */
export function buildCcliReport(
  rows: SongUsageRow[],
  from: string,
  to: string,
): CcliReport {
  const inRange = filterUsagesByRange(rows, from, to);
  const lines: CcliReportLine[] = [];
  const unregistered: UnregisteredSongLine[] = [];

  for (const [songId, group] of groupBySong(inRange)) {
    const first = group[0];
    if (first.ccliNumber == null) {
      unregistered.push({ songId, title: first.title, totalPlays: group.length });
      continue;
    }
    lines.push({
      songId,
      title: first.title,
      ccliNumber: first.ccliNumber,
      totalPlays: group.length,
      serviceDates: sortedDistinctDates(group),
    });
  }

  lines.sort(byTitle);
  unregistered.sort(byTitle);

  return {
    from,
    to,
    lines,
    unregistered,
    totals: {
      totalPlays: lines.reduce((n, l) => n + l.totalPlays, 0),
      reportableSongs: lines.length,
      unregisteredSongs: unregistered.length,
    },
  };
}

// ---------------------------------------------------------------------------
// CSV serialization (RFC 4180 style: quote on comma/quote/newline, double "")
// ---------------------------------------------------------------------------

function escapeField(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialize one CSV row with proper quoting/escaping. */
export function toCsvRow(fields: (string | number)[]): string {
  return fields.map(escapeField).join(",");
}

/** TONO report → CSV (header + one row per reportable song, streaming split). */
export function tonoReportToCsv(report: TonoReport): string {
  const header = toCsvRow([
    "title",
    "tono_work_id",
    "total_plays",
    "gathered_plays",
    "streamed_plays",
    "service_dates",
  ]);
  const rows = report.lines.map((l) =>
    toCsvRow([
      l.title,
      l.tonoWorkId,
      l.totalPlays,
      l.gatheredPlays,
      l.streamedPlays,
      l.serviceDates.join(" "),
    ]),
  );
  return [header, ...rows].join("\n");
}

/** CCLI report → CSV (header + one row per reportable song). */
export function ccliReportToCsv(report: CcliReport): string {
  const header = toCsvRow(["title", "ccli_number", "total_plays", "service_dates"]);
  const rows = report.lines.map((l) =>
    toCsvRow([l.title, l.ccliNumber, l.totalPlays, l.serviceDates.join(" ")]),
  );
  return [header, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// Date-range helpers (deterministic — the UI's default period)
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The calendar quarter (3-month window) containing `ref`, as `[from, to)`
 * where `from` is the first day of the quarter and `to` is the first day of
 * the next quarter (exclusive). The sensible default for licensing reports —
 * TONO is filed quarterly.
 */
export function quarterRange(ref: Date): { from: string; to: string } {
  const year = ref.getFullYear();
  const q = Math.floor(ref.getMonth() / 3); // 0..3
  const fromMonth = q * 3; // 0,3,6,9
  const from = `${year}-${pad(fromMonth + 1)}-01`;
  const toYear = fromMonth + 3 >= 12 ? year + 1 : year;
  const toMonth = (fromMonth + 3) % 12;
  const to = `${toYear}-${pad(toMonth + 1)}-01`;
  return { from, to };
}

/** A short human label for a range, e.g. "2026-04-01 → 2026-07-01". */
export function rangeLabel(from: string, to: string): string {
  return `${from} → ${to}`;
}
