/**
 * Availability data layer — a member's declared unavailability (when they
 * CANNOT serve; we assume they can otherwise). These records are the same ones
 * the scoring engine gates on and the conflict engine flags against, so editing
 * them here directly changes who auto-fill picks and which assignments warn.
 *
 * Privacy: planners always see the dates, but the reason is hidden unless the
 * member made it visible (reason_visibility !== 'private').
 */
import type { Availability, AvailabilityKind, AvailabilityVisibility } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/server";
import { formatCalendarFull } from "@/lib/i18n/date";

export interface AvailabilityRow {
  id: string;
  kind: AvailabilityKind;
  summary: string;
  reason: string | null; // null when hidden by visibility
  reason_visibility: AvailabilityVisibility;
}

/**
 * Weekday names for recurring availability patterns — Intl gives us the right
 * locale-sensitive name from a fixed day-of-week index (0=Sun).
 */
function weekdayLabel(weekday: string, locale: string): string {
  const DAY_INDEX: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const idx = DAY_INDEX[weekday];
  if (idx === undefined) return weekday;
  // Use a known week anchor: 2023-01-01 is a Sunday (UTC).
  const date = new Date(Date.UTC(2023, 0, 1 + idx, 12));
  const bcp47 = locale === "no" ? "nb-NO" : "en-GB";
  const day = new Intl.DateTimeFormat(bcp47, { weekday: "long", timeZone: "UTC" }).format(date);
  // Norwegian: "Every mandag" → better phrasing varies, but keep parallel with English.
  return locale === "no" ? `Hver ${day}` : `Every ${day}`;
}

/** Human-readable description of an availability record's pattern. */
function summarize(av: Availability, locale: string): string {
  const p = av.pattern as Record<string, unknown>;
  if (av.kind === "recurring" && typeof p.weekday === "string") {
    return weekdayLabel(p.weekday, locale);
  }
  if (av.kind === "range" && typeof p.from === "string" && typeof p.to === "string") {
    return `${formatCalendarFull(p.from, locale)} – ${formatCalendarFull(p.to, locale)}`;
  }
  if (av.kind === "specific" && Array.isArray(p.dates)) {
    return (p.dates as string[]).map((d) => formatCalendarFull(d, locale)).join(", ");
  }
  return "—";
}

/** A member's unavailability records, newest first, with reason privacy applied. */
export async function getMemberAvailability(
  memberId: string,
  locale = "no",
): Promise<AvailabilityRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("availability")
    .select("id, member_id, kind, pattern, reason, reason_visibility, created_at")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as unknown as (Availability & { created_at: string })[]).map((av) => ({
    id: av.id,
    kind: av.kind,
    summary: summarize(av, locale),
    reason: av.reason_visibility === "private" ? null : av.reason,
    reason_visibility: av.reason_visibility,
  }));
}
