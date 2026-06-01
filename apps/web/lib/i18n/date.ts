/**
 * Locale-aware date formatting utilities. All functions accept a SundayPlan
 * locale string ("no" | "en") and return human-readable strings using the
 * platform Intl.DateTimeFormat — no arrays of hard-coded English month/weekday
 * names. Dates from the database are stored as UTC ISO strings; helpers that
 * accept those use `timeZone: "UTC"` so the display matches the stored value
 * irrespective of the server's local TZ.
 *
 * Plain calendar dates (YYYY-MM-DD, e.g. availability blockouts) should be
 * parsed with `calendarDate()` to avoid any midnight-UTC-vs-local-midnight shift.
 */

/** Map our locale codes to BCP 47 tags. */
function bcp47(locale: string): string {
  return locale === "no" ? "nb-NO" : "en-GB";
}

/**
 * Compact date+time for a UTC ISO timestamp, e.g.
 *   "no" → "søn. 5. jan. · 10:00"
 *   "en" → "Sun 5 Jan · 10:00"
 */
export function formatWhenShort(iso: string, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const datePart = new Intl.DateTimeFormat(bcp47(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${datePart} · ${hh}:${mm}`;
}

/**
 * Long date+time for a UTC ISO timestamp, e.g.
 *   "no" → "søndag 5. januar 2026 · 10:00"
 *   "en" → "Sunday, 5 January 2026 · 10:00"
 */
export function formatWhenLong(iso: string, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const datePart = new Intl.DateTimeFormat(bcp47(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${datePart} · ${hh}:${mm}`;
}

/**
 * Compact date label for a UTC ISO timestamp with no time, e.g.
 *   "no" → "7. jun. 2026"
 *   "en" → "7 Jun 2026"
 */
export function formatDateCompact(iso: string, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Intl.DateTimeFormat(bcp47(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/**
 * Grid column label from a UTC ISO timestamp, e.g.
 *   "no" → "7. jun."
 *   "en" → "7 Jun"
 */
export function formatGridLabel(iso: string, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Intl.DateTimeFormat(bcp47(locale), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
}

/**
 * Short month+day for a plain calendar date string ("YYYY-MM-DD"), e.g.
 *   "no" → "5. jan."
 *   "en" → "5 Jan"
 * Uses noon UTC to avoid any midnight-UTC shift.
 */
export function formatCalendarShort(ymd: string, locale: string): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  // Use noon UTC so no TZ offset can shift the displayed date.
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat(bcp47(locale), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Full date for a plain calendar date string ("YYYY-MM-DD"), e.g.
 *   "no" → "5. januar 2026"
 *   "en" → "5 January 2026"
 */
export function formatCalendarFull(ymd: string, locale: string): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat(bcp47(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
