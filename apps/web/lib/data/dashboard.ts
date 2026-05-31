/**
 * Dashboard data layer — the "at a glance" home screen, composed entirely from
 * existing live-data sources so it never drifts from the pages it summarises:
 *
 *  - next service + coverage  → getServices() (already computes filled/required)
 *  - conflicts + open slots   → getSchedule() (already runs detectConflicts)
 *  - pending RSVPs            → assignment.status in (invited, no_response)
 *  - onboarding checklist     → cheap head-count probes
 *
 * Everything reads under the planner's RLS (cookie-bound server client). This
 * replaces the old `@/lib/mock` fixtures the dashboard used to render.
 */
import type { Conflict } from "@sundayplan/sdk";
import { createClient } from "@/lib/supabase/server";
import { getServices, type ServiceSummary } from "@/lib/data/services";
import { getSchedule } from "@/lib/data/schedule";
import { getChurchProfile } from "@/lib/data/settings";

export interface DashboardChecklist {
  hasTeam: boolean;
  hasRole: boolean;
  hasMembers: boolean; // ≥ 3 people on the roster
  hasService: boolean;
  hasMessage: boolean;
  /** True once every step above is done — hides the checklist. */
  complete: boolean;
}

export interface DashboardData {
  nextService: ServiceSummary | null;
  /** Localised "Sun 7 Jun · 11:00" for the next service, in the church timezone. */
  nextServiceWhen: string | null;
  pendingRsvps: number;
  openSlots: number;
  hardConflicts: number;
  conflicts: Conflict[];
  roleNames: Record<string, string>;
  memberNames: Record<string, string>;
  checklist: DashboardChecklist;
  /** Totals that decide whether to show the first-run empty state. */
  totals: { services: number; members: number };
}

function formatWhen(iso: string, timezone: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "no" ? "nb-NO" : locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toUTCString();
  }
}

export async function getDashboard(): Promise<DashboardData> {
  const supabase = await createClient();

  const [services, schedule, profile, rsvpRes, teamCount, roleCount, memberCount, messageCount] =
    await Promise.all([
      getServices(),
      getSchedule(),
      getChurchProfile(),
      supabase.from("assignment").select("status, service(starts_at_utc)"),
      supabase.from("team").select("id", { count: "exact", head: true }),
      supabase.from("role").select("id", { count: "exact", head: true }),
      supabase.from("member").select("id", { count: "exact", head: true }),
      supabase.from("message").select("id", { count: "exact", head: true }),
    ]);

  const now = Date.now();

  // Next service = soonest future draft/published service.
  const nextService =
    services.find(
      (s) =>
        new Date(s.starts_at_utc).getTime() >= now &&
        (s.state === "draft" || s.state === "published"),
    ) ?? null;

  // Pending RSVPs across upcoming services (a volunteer has been asked but
  // hasn't answered yet) — these are the rows a planner chases before Sunday.
  interface RsvpRow {
    status: string;
    service: { starts_at_utc: string } | null;
  }
  const pendingRsvps = ((rsvpRes.data ?? []) as unknown as RsvpRow[]).filter(
    (a) =>
      (a.status === "invited" || a.status === "no_response") &&
      a.service != null &&
      new Date(a.service.starts_at_utc).getTime() >= now,
  ).length;

  const openSlots = schedule.conflicts.filter((c) => c.rule === "unfilled_near_deadline").length;
  const hardConflicts = schedule.conflicts.filter((c) => c.severity === "hard").length;
  const roleNames = Object.fromEntries(schedule.roles.map((r) => [r.id, r.name]));

  const checklist: DashboardChecklist = {
    hasTeam: (teamCount.count ?? 0) >= 1,
    hasRole: (roleCount.count ?? 0) >= 1,
    hasMembers: (memberCount.count ?? 0) >= 3,
    hasService: services.length >= 1,
    hasMessage: (messageCount.count ?? 0) >= 1,
    complete: false,
  };
  checklist.complete =
    checklist.hasTeam &&
    checklist.hasRole &&
    checklist.hasMembers &&
    checklist.hasService &&
    checklist.hasMessage;

  return {
    nextService,
    nextServiceWhen:
      nextService && profile
        ? formatWhen(nextService.starts_at_utc, profile.timezone, profile.locale)
        : null,
    pendingRsvps,
    openSlots,
    hardConflicts,
    conflicts: schedule.conflicts,
    roleNames,
    memberNames: schedule.memberNames,
    checklist,
    totals: { services: services.length, members: memberCount.count ?? 0 },
  };
}
