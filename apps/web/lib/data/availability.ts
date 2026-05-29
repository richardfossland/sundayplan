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

export interface AvailabilityRow {
  id: string;
  kind: AvailabilityKind;
  summary: string;
  reason: string | null; // null when hidden by visibility
  reason_visibility: AvailabilityVisibility;
}

const WEEKDAY_LABEL: Record<string, string> = {
  sunday: "Sundays",
  monday: "Mondays",
  tuesday: "Tuesdays",
  wednesday: "Wednesdays",
  thursday: "Thursdays",
  friday: "Fridays",
  saturday: "Saturdays",
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** `2026-06-15` → `15 Jun 2026` (parsed as a plain calendar date). */
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Human-readable description of an availability record's pattern. */
function summarize(av: Availability): string {
  const p = av.pattern as Record<string, unknown>;
  if (av.kind === "recurring" && typeof p.weekday === "string") {
    return `Every ${WEEKDAY_LABEL[p.weekday] ?? p.weekday}`;
  }
  if (av.kind === "range" && typeof p.from === "string" && typeof p.to === "string") {
    return `${prettyDate(p.from)} – ${prettyDate(p.to)}`;
  }
  if (av.kind === "specific" && Array.isArray(p.dates)) {
    return (p.dates as string[]).map(prettyDate).join(", ");
  }
  return "—";
}

/** A member's unavailability records, newest first, with reason privacy applied. */
export async function getMemberAvailability(memberId: string): Promise<AvailabilityRow[]> {
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
    summary: summarize(av),
    reason: av.reason_visibility === "private" ? null : av.reason,
    reason_visibility: av.reason_visibility,
  }));
}
