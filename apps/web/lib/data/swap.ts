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
      "id, display_name, household, joined_at, target_serves_per_month, availability(id, member_id, kind, pattern, reason, reason_visibility)",
    ),
    sb.from("team_membership").select("member_id, role_id, skill_level, is_key_person"),
    sb.from("church_settings").select("default_max_assignments_per_month, unfilled_warn_days, max_consecutive_sundays, min_rest_days"),
  ]);

  interface ServiceRow { id: string; starts_at_utc: string }
  interface RoleRow { id: string; skill_required: SkillLevel }
  interface AsgRow { service_id: string; role_id: string; member_id: string; status: string }
  interface MemberRow {
    id: string; display_name: string; household: string | null; joined_at: string | null;
    target_serves_per_month: number | null;
    availability: Availability[] | null;
  }
  interface MshipRow { member_id: string; role_id: string; skill_level: SkillLevel; is_key_person: boolean }

  const services = (servicesRes.data ?? []) as ServiceRow[];
  const roles = (rolesRes.data ?? []) as RoleRow[];
  const assignments = (assignmentsRes.data ?? []) as AsgRow[];
  const members = (membersRes.data ?? []) as MemberRow[];
  const memberships = (membershipsRes.data ?? []) as MshipRow[];
  const settings = (Array.isArray(settingsRes.data) ? settingsRes.data[0] : settingsRes.data) as
    | {
        default_max_assignments_per_month?: number;
        unfilled_warn_days?: number;
        max_consecutive_sundays?: number;
        min_rest_days?: number;
      }
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
    // No per-member override column exists on `member`; the cap comes from the
    // church-wide setting (mirrors lib/data/schedule.ts + autofill.ts).
    max_assignments_per_month: maxPerMonth,
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
      // Hard rest window (rule 11) — 0 = off, so swap suggestions that violate a
      // configured window are surfaced as a hard conflict like everywhere else.
      min_rest_days: settings?.min_rest_days ?? 0,
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

/**
 * One open swap row, joined to the human-readable context a planner needs to act
 * on it: who handed the slot back, which service/role, and when the service is.
 * Resolved entirely server-side so the planner page is a thin render.
 */
export interface OpenSwap {
  id: string;
  assignment_id: string;
  status: string;
  note: string | null;
  created_at: string;
  requested_by_member_id: string;
  requested_by_name: string;
  service_id: string;
  service_title: string;
  service_starts_at: string;
  role_id: string;
  role_name: string;
  /** The vacated member on the original assignment (for findReplacements input). */
  vacated_member_id: string;
}

/**
 * Minimal client surface for the planner-side reads here. We only need a
 * filtered, ordered single-table select; the chaining is intentionally typed
 * with `any` so structurally matching the full Supabase builder doesn't trip
 * TS's "excessively deep" guard (the runtime contract is exact).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryClient = { from: (table: string) => any };

interface OpenSwapRow {
  id: string;
  assignment_id: string;
  status: string;
  note: string | null;
  created_at: string;
  requested_by_member_id: string;
  requester: { display_name: string } | null;
  assignment: {
    member_id: string;
    service_id: string;
    role_id: string;
    role: { name: string } | null;
    service: { name: string; starts_at_utc: string } | null;
  } | null;
}

/**
 * List the church's open swap requests (volunteers who handed a slot back),
 * newest first, with service/role/requester resolved. Reads under whatever
 * client is passed — planners use the RLS server client, which scopes to their
 * church and to the `swap_planner_all` policy.
 */
export async function listOpenSwaps(supabase: QueryClient): Promise<OpenSwap[]> {
  const { data } = await supabase
    .from("swap_request")
    .select(
      "id, assignment_id, status, note, created_at, requested_by_member_id, " +
        "requester:requested_by_member_id(display_name), " +
        "assignment:assignment_id(member_id, service_id, role_id, role:role_id(name), service:service_id(name, starts_at_utc))",
    )
    .eq("status", "open")
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as OpenSwapRow[];
  return rows
    .filter((r) => r.assignment != null)
    .map((r) => ({
      id: r.id,
      assignment_id: r.assignment_id,
      status: r.status,
      note: r.note,
      created_at: r.created_at,
      requested_by_member_id: r.requested_by_member_id,
      requested_by_name: r.requester?.display_name ?? r.requested_by_member_id,
      service_id: r.assignment!.service_id,
      service_title: r.assignment!.service?.name ?? "",
      service_starts_at: r.assignment!.service?.starts_at_utc ?? "",
      role_id: r.assignment!.role_id,
      role_name: r.assignment!.role?.name ?? "",
      vacated_member_id: r.assignment!.member_id,
    }));
}
