/**
 * Pure, network-free iCalendar (RFC 5545) builder for read-only booking feeds
 * (Phase 4, feature 3). Deterministic + unit-tested (lib/ics.test.ts) — no
 * Supabase, no Date.now() in the exported math (the caller passes DTSTAMP).
 *
 * A VCALENDAR with one VEVENT per booking. Times are emitted as UTC
 * (`YYYYMMDDTHHMMSSZ`). UID is per-booking + a stable domain so re-fetches
 * de-duplicate in Google/Apple/Outlook. Text fields are escaped per RFC 5545
 * (backslash, comma, semicolon, newline) and long lines are folded at 75 octets.
 */

export interface IcsEvent {
  /** Stable unique id (booking id). */
  uid: string;
  /** ISO-8601 / epoch-parseable start + end (UTC instants). */
  start: string;
  end: string;
  summary: string;
  location?: string | null;
  description?: string | null;
  /** Status maps to STATUS (CONFIRMED/TENTATIVE/CANCELLED). */
  status?: "approved" | "pending" | "declined" | "cancelled" | null;
}

export interface IcsCalendarOptions {
  /** Calendar display name (X-WR-CALNAME), e.g. "Storsalen — SundayBooking". */
  calName: string;
  /** Domain for UID suffix, e.g. "booking.sundaysuite.app". */
  uidDomain: string;
  /** DTSTAMP for every event + the calendar (injectable for tests). */
  dtstamp: Date;
  /** PRODID; defaults to the SundayBooking product id. */
  prodId?: string;
}

/** Escape a text value per RFC 5545 §3.3.11. */
export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

/** Format a UTC instant as `YYYYMMDDTHHMMSSZ`. */
export function formatIcsUtc(iso: string | number | Date): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** Fold a content line at 75 octets with leading-space continuation (§3.1). */
export function foldLine(line: string): string {
  // Operate on UTF-8 bytes so multi-byte chars aren't split mid-codepoint at a
  // boundary; we fold conservatively on character count of the encoded bytes.
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let chunkStart = 0;
  let count = 0;
  let lastCut = 0;
  // Walk characters, tracking byte length; cut before exceeding 75 (74 on
  // continuation lines because of the leading space).
  let limit = 75;
  for (let i = 0; i < line.length; i++) {
    const cp = line.codePointAt(i)!;
    if (cp > 0xffff) i++; // surrogate pair
    const charBytes = Buffer.byteLength(String.fromCodePoint(cp), "utf8");
    if (count + charBytes > limit) {
      out.push(line.slice(chunkStart, i));
      chunkStart = i;
      count = charBytes;
      limit = 74;
      lastCut = i;
    } else {
      count += charBytes;
    }
  }
  out.push(line.slice(chunkStart));
  void lastCut;
  return out.map((c, i) => (i === 0 ? c : " " + c)).join("\r\n");
}

const STATUS_MAP: Record<string, string> = {
  approved: "CONFIRMED",
  pending: "TENTATIVE",
  declined: "CANCELLED",
  cancelled: "CANCELLED",
};

/** Build a single VEVENT block (array of unfolded lines). */
function vevent(ev: IcsEvent, opts: IcsCalendarOptions): string[] {
  const lines: string[] = ["BEGIN:VEVENT"];
  lines.push(`UID:${escapeIcsText(ev.uid)}@${opts.uidDomain}`);
  lines.push(`DTSTAMP:${formatIcsUtc(opts.dtstamp)}`);
  lines.push(`DTSTART:${formatIcsUtc(ev.start)}`);
  lines.push(`DTEND:${formatIcsUtc(ev.end)}`);
  lines.push(`SUMMARY:${escapeIcsText(ev.summary)}`);
  if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
  if (ev.status && STATUS_MAP[ev.status]) lines.push(`STATUS:${STATUS_MAP[ev.status]}`);
  lines.push("END:VEVENT");
  return lines;
}

/**
 * Assemble a full VCALENDAR document (CRLF-terminated, folded). The output is a
 * complete `text/calendar` body ready to serve.
 */
export function buildIcsCalendar(events: IcsEvent[], opts: IcsCalendarOptions): string {
  const prodId = opts.prodId ?? "-//SundaySuite//SundayBooking//NO";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${prodId}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(opts.calName)}`,
  ];
  for (const ev of events) lines.push(...vevent(ev, opts));
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
