/**
 * Swap / substitute-finder data layer. Assembles the live schedule into the
 * SDK's `eligibleReplacements` inputs so a declining volunteer (or a planner)
 * gets a ranked shortlist of subs who can actually cover the slot without
 * creating a new hard conflict — GraceSquad/PC "find your replacement".
 *
 * Reads run under whatever client is passed: planner reads use the RLS server
 * client; volunteer reads (token-authorized) use the service-role admin client
 * scoped to the claim. Mirrors the assembly in lib/data/autofill.ts + schedule.ts.
 */
import {
  eligibleReplacements,
  consecutiveWeeksServed,
  type ConflictContext,
  type PlacedAssignment,
  type MemberInfo,
  type KeyPerson,
  type RankedReplacement,
} from "@sundayplan/sdk";
import type { Availability, SkillLevel } from "@sundayplan/shared";

const DAY_MS = 86_400_000;

/**
 * Minimal client surface satisfied by both the RLS server client and the
 * service-role admin client — we only ever `from(table).select(cols)` and await.
 */
type DbClient = {
  from: (table: string) => { select: (cols: string) => PromiseLike<{ data: unknown; error: unknown }> };
};

interface TargetAssignment {
  id: string;
  church_id: string;
  service_id: string;
  role_id: string;
  member_id: string;
}

/**
 * Rank substitutes for the slot held by `assignment`. The declining member and
 * anyone already serving that service are excluded; everyone else trained for
 * the role is scored + conflict-checked.
 */
export async function findReplacements(
  supabase: DbClient,
  assignment: TargetAssignment,
  now: Date = new Date(),
): Promise<RankedReplacement[]> {
  const sb = supabase;

  const [servicesRes, rolesRes, assignmentsRes, membersRes, membershipsRes, settingsRes] = await Promise.all([
    sb.from("service").select("id, starts_at_utc"),
    sb.from("role").select("id, skill_required"),
    sb.from("assignment").select("service_id, role_id, member_id, status"),
    sb.from("member").select(
      "id, display_name, household, joined_at, target_serves_per_month, max_assignments_per_month, availability(id, member_id, kind, pattern, reason, reason_visibility)",
    ),
    sb.from("team_membership").select("member_id, role_id, skill_level, is_key_person"),
    sb.from("church_settings").select("default_max_assignments_per_month, unfilled_warn_days, max_consecutive_sundays"),
  ]);

  interface ServiceRow { id: string; starts_at_utc: string }
  interface RoleRow { id: string; skill_required: SkillLevel }
  interface AsgRow { service_id: string; role_id: string; member_id: string; status: string }
  interface MemberRow {
    id: string; display_name: string; household: string | null; joined_at: string | null;
    target_serves_per_month: number | null; max_assignments_per_month: number | null;
    availability: Availability[] | null;
  }
  interface MshipRow { member_id: string; role_id: string; skill_level: SkillLevel; is_key_person: boolean }

  const services = (servicesRes.data ?? []) as ServiceRow[];
  const roles = (rolesRes.data ?? []) as RoleRow[];
  const assignments = (assignmentsRes.data ?? []) as AsgRow[];
  const members = (membersRes.data ?? []) as MemberRow[];
  const memberships = (membershipsRes.data ?? []) as MshipRow[];
  const settings = (Array.isArray(settingsRes.data) ? settingsRes.data[0] : settingsRes.data) as
    | { default_max_assignments_per_month?: number; unfilled_warn_days?: number; max_consecutive_sundays?: number }
    | null;

  const serviceStart = new Map(services.map((s) => [s.id, new Date(s.starts_at_utc)]));
  const roleSkill = new Map(roles.map((r) => [r.id, r.skill_required]));
  const memberById = new Map(members.map((m) => [m.id, m]));
  const skillByMemberRole = new Map(memberships.map((tm) => [`${tm.member_id}:${tm.role_id}`, tm.skill_level]));
  const maxPerMonth = settings?.default_max_assignments_per_month ?? 3;
  const targetStart = serviceStart.get(assignment.service_id) ?? now;

  // Active placements EXCLUDING the slot being vacated (so the replacement isn't
  // judged against the assignment they're replacing).
  const active = assignments.filter(
    (a) =>
      a.status !== "declined" &&
      a.status !== "removed" &&
      !(a.service_id === assignment.service_id && a.role_id === assignment.role_id && a.member_id === assignment.member_id),
  );

  const placed: PlacedAssignment[] = active.map((a) => ({
    member_id: a.member_id,
    service_id: a.service_id,
    role_id: a.role_id,
    skill_level: skillByMemberRole.get(`${a.member_id}:${a.role_id}`) ?? "capable",
    role_skill_required: roleSkill.get(a.role_id) ?? "capable",
  }));

  const memberInfo: MemberInfo[] = members.map((m) => ({
    id: m.id,
    display_name: m.display_name,
    availability: m.availability ?? [],
    max_assignments_per_month: m.max_assignments_per_month ?? maxPerMonth,
    household_id: m.household,
  }));

  const keyPersons: KeyPerson[] = memberships
    .filter((tm) => tm.is_key_person)
    .map((tm) => ({ member_id: tm.member_id, role_id: tm.role_id }));

  const ctx: ConflictContext = {
    services: services.map((s) => ({ id: s.id, starts_at: new Date(s.starts_at_utc) })),
    assignments: placed,
    members: memberInfo,
    keyPersons,
    config: {
      unfilled_warn_days: settings?.unfilled_warn_days ?? 7,
      max_consecutive_sundays: settings?.max_consecutive_sundays ?? 3,
    },
    now,
  };

  // Accepted history per member (for rotation/frequency signals).
  const acceptedAny = new Map<string, Date[]>();
  const acceptedSameRole = new Map<string, Date[]>();
  for (const a of assignments) {
    if (a.status !== "accepted") continue;
    const when = serviceStart.get(a.service_id);
    if (!when || when.getTime() >= now.getTime()) continue;
    (acceptedAny.get(a.member_id) ?? acceptedAny.set(a.member_id, []).get(a.member_id)!).push(when);
    const k = `${a.member_id}:${a.role_id}`;
    (acceptedSameRole.get(k) ?? acceptedSameRole.set(k, []).get(k)!).push(when);
  }
  const ninetyAgo = now.getTime() - 90 * DAY_MS;
  const daysSince = (dates: Date[] | undefined): number | null => {
    if (!dates || dates.length === 0) return null;
    return Math.floor((now.getTime() - Math.max(...dates.map((d) => d.getTime()))) / DAY_MS);
  };

  // Candidate pool: trained for the role, not the declining member, not already
  // serving this service.
  const servingThisService = new Set(
    active.filter((a) => a.service_id === assignment.service_id).map((a) => a.member_id),
  );
  const required = roleSkill.get(assignment.role_id) ?? "capable";

  const candidates = memberships
    .filter((tm) => tm.role_id === assignment.role_id)
    .filter((tm) => tm.member_id !== assignment.member_id && !servingThisService.has(tm.member_id))
    .map((tm) => {
      const m = memberById.get(tm.member_id);
      const anyDates = acceptedAny.get(tm.member_id);
      return {
        member_id: tm.member_id,
        placement: {
          member_id: tm.member_id,
          service_id: assignment.service_id,
          role_id: assignment.role_id,
          skill_level: tm.skill_level,
          role_skill_required: required,
        } satisfies PlacedAssignment,
        scoring: {
          candidate: {
            member_id: tm.member_id,
            skill_level: tm.skill_level,
            accepted_recent_count: (anyDates ?? []).filter((d) => d.getTime() >= ninetyAgo).length,
            days_since_last_assignment: daysSince(anyDates),
            days_since_last_assignment_same_role: daysSince(acceptedSameRole.get(`${tm.member_id}:${assignment.role_id}`)),
            target_serves_per_month: m?.target_serves_per_month ?? 2,
            availability: m?.availability ?? [],
            consecutive_weeks_served: consecutiveWeeksServed(anyDates ?? [], now),
            has_frequent_partner_on_service: false,
            has_trainer_paired: false,
          },
          slot: { service_starts_at: targetStart, role_skill_required: required },
        },
      };
    });

  return eligibleReplacements({ ctx, candidates, excludeMemberIds: [assignment.member_id] });
}
