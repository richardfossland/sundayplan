/**
 * Schedule data layer — assembles the rota grid and runs the real conflict
 * engine over live Supabase data (all reads under the planner's RLS). Replaces
 * the schedule mock: the grid shows actual assignments across the church's
 * services, and detectConflicts() runs on those same rows — e.g. a member whose
 * skill in a role is below the role's `skill_required` surfaces as a real
 * skill_gap, not a crafted one.
 */
import {
  detectConflicts,
  parseRequiredCredentials,
  type CredentialKind,
  type Conflict,
  type ConflictContext,
  type MemberCredential,
  type MemberInfo,
  type PlacedAssignment,
  type RoleRequirement,
  type KeyPerson,
} from "@sundayplan/sdk";
import type { Availability, AssignmentStatus, SkillLevel } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/server";

export interface GridService {
  id: string;
  label: string;
}

export interface GridRole {
  id: string;
  name: string;
  skill: SkillLevel;
}

export interface GridCell {
  assignment_id: string;
  service_id: string;
  role_id: string;
  member_id: string;
  status: AssignmentStatus;
}

/** A member eligible for a role (trained for it via a team membership). */
export interface EligibleMember {
  id: string;
  name: string;
  skill: SkillLevel;
}

export interface ScheduleData {
  services: GridService[];
  roles: GridRole[];
  cells: GridCell[];
  conflicts: Conflict[];
  memberNames: Record<string, string>;
  /** Candidate members per role id, best skill first — drives the assign picker. */
  eligibleByRole: Record<string, EligibleMember[]>;
  /** Required slot count per `${service_id}|${role_id}` (templated services). */
  requiredByServiceRole: Record<string, number>;
  /** Role display names, by id — used by the planning agent's diff narration. */
  roleNames: Record<string, string>;
  /** Service column labels, by id — used by the planning agent's diff narration. */
  serviceLabels: Record<string, string>;
  /**
   * The fully-assembled conflict-engine context for the live schedule. Exposed
   * so the Pastor's-chat agent can run `detectConflicts` as a tool over the same
   * snapshot the grid shows, without re-querying. (Already computed here.)
   */
  conflictContext: ConflictContext;
}

const SKILL_RANK: Record<SkillLevel, number> = {
  training: 0,
  capable: 1,
  lead: 2,
  trainer: 3,
};

/** Compact column label, e.g. "7. jun." (no) or "7 Jun" (en), from a UTC service start. */
function shortLabel(iso: string, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const bcp47 = locale === "no" ? "nb-NO" : "en-GB";
  return new Intl.DateTimeFormat(bcp47, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
}

interface ServiceRow {
  id: string;
  starts_at_utc: string;
  template_id: string | null;
}
interface RequirementRow {
  template_id: string;
  role_id: string;
  quantity: number;
}
interface RoleRow {
  id: string;
  name: string;
  skill_required: SkillLevel;
  required_credentials: string[] | null;
}
interface AssignmentRow {
  id: string;
  service_id: string;
  role_id: string;
  member_id: string;
  status: AssignmentStatus;
}
interface MemberRow {
  id: string;
  display_name: string;
  household: string | null;
  availability: Availability[] | null;
}
interface MembershipRow {
  member_id: string;
  role_id: string;
  skill_level: SkillLevel;
  is_key_person: boolean;
}
interface CredentialRow {
  member_id: string;
  kind: CredentialKind;
  status: MemberCredential["status"];
  expires_at: string | null;
}

/**
 * The full schedule view: grid + conflicts, for the planner's church.
 *
 * `requirements` (per-service role needs) are not modelled yet — service↔role
 * requirements live on service_template and seed services aren't templated — so
 * the unfilled-slot rule stays dormant until that lands. Every other rule runs.
 */
export async function getSchedule(locale = "no"): Promise<ScheduleData> {
  const supabase = await createClient();

  const [services, roles, assignments, members, memberships, requirements, credentials, settings] =
    await Promise.all([
      supabase.from("service").select("id, starts_at_utc, template_id").order("starts_at_utc"),
      supabase.from("role").select("id, name, skill_required, required_credentials").order("name"),
      supabase.from("assignment").select("id, service_id, role_id, member_id, status"),
      supabase.from("member").select(
        "id, display_name, household, availability(id, member_id, kind, pattern, reason, reason_visibility)",
      ),
      supabase.from("team_membership").select("member_id, role_id, skill_level, is_key_person"),
      supabase.from("service_team_requirement").select("template_id, role_id, quantity"),
      supabase.from("member_credential").select("member_id, kind, status, expires_at"),
      supabase
        .from("church_settings")
        .select("default_max_assignments_per_month, unfilled_warn_days, max_consecutive_sundays, min_rest_days")
        .maybeSingle(),
    ]);

  for (const r of [services, roles, assignments, members, memberships, requirements]) {
    if (r.error) throw r.error;
  }
  // The credential table may not exist pre-migration (0011); treat its error as
  // "no credentials" so the grid still renders rather than throwing.
  const credentialRows = (credentials.data ?? []) as unknown as CredentialRow[];

  const serviceRows = (services.data ?? []) as unknown as ServiceRow[];
  const requirementRows = (requirements.data ?? []) as unknown as RequirementRow[];
  const roleRows = (roles.data ?? []) as unknown as RoleRow[];
  const assignmentRows = (assignments.data ?? []) as unknown as AssignmentRow[];
  const memberRows = (members.data ?? []) as unknown as MemberRow[];
  const membershipRows = (memberships.data ?? []) as unknown as MembershipRow[];
  const maxPerMonth =
    (settings.data?.default_max_assignments_per_month as number | undefined) ?? 3;
  const conflictConfig = {
    unfilled_warn_days: (settings.data?.unfilled_warn_days as number | undefined) ?? 7,
    max_consecutive_sundays:
      (settings.data?.max_consecutive_sundays as number | undefined) ?? 3,
    // Default 0 = off (and the column may not exist pre-migration 0014), so the
    // hard rest-window rule stays dormant until a church opts in.
    min_rest_days: (settings.data?.min_rest_days as number | undefined) ?? 0,
  };

  const gridServices: GridService[] = serviceRows.map((s) => ({
    id: s.id,
    label: shortLabel(s.starts_at_utc, locale),
  }));
  const gridRoles: GridRole[] = roleRows.map((r) => ({
    id: r.id,
    name: r.name,
    skill: r.skill_required,
  }));
  const cells: GridCell[] = assignmentRows.map((a) => ({
    assignment_id: a.id,
    service_id: a.service_id,
    role_id: a.role_id,
    member_id: a.member_id,
    status: a.status,
  }));

  const memberNames: Record<string, string> = Object.fromEntries(
    memberRows.map((m) => [m.id, m.display_name]),
  );
  const roleSkillById = new Map(roleRows.map((r) => [r.id, r.skill_required]));
  // A member's skill *in a given role* comes from their team membership.
  const skillByMemberRole = new Map(
    membershipRows.map((tm) => [`${tm.member_id}:${tm.role_id}`, tm.skill_level]),
  );

  // Candidate pool per role = members trained for it (a team membership on the
  // role), best skill first then name — this is what the assign picker offers.
  const eligibleByRole: Record<string, EligibleMember[]> = {};
  for (const tm of membershipRows) {
    (eligibleByRole[tm.role_id] ??= []).push({
      id: tm.member_id,
      name: memberNames[tm.member_id] ?? tm.member_id,
      skill: tm.skill_level,
    });
  }
  for (const list of Object.values(eligibleByRole)) {
    list.sort(
      (a, b) => SKILL_RANK[b.skill] - SKILL_RANK[a.skill] || a.name.localeCompare(b.name),
    );
  }

  // Conflicts run only over active (not declined/removed) placements.
  const active = assignmentRows.filter(
    (a) => a.status !== "declined" && a.status !== "removed",
  );
  const placed: PlacedAssignment[] = active.map((a) => ({
    member_id: a.member_id,
    service_id: a.service_id,
    role_id: a.role_id,
    // Unknown skill in this role (assigned outside their team) → neutral
    // 'capable' so we neither hide nor fabricate a gap.
    skill_level: skillByMemberRole.get(`${a.member_id}:${a.role_id}`) ?? "capable",
    role_skill_required: roleSkillById.get(a.role_id) ?? "capable",
  }));

  // Held credentials per member, for the credential-gap rule.
  const heldByMember = new Map<string, MemberCredential[]>();
  for (const c of credentialRows) {
    const list = heldByMember.get(c.member_id) ?? [];
    list.push({ kind: c.kind, status: c.status, expires_at: c.expires_at });
    heldByMember.set(c.member_id, list);
  }

  const memberInfo: MemberInfo[] = memberRows.map((m) => ({
    id: m.id,
    display_name: m.display_name,
    availability: m.availability ?? [],
    max_assignments_per_month: maxPerMonth,
    household_id: m.household,
    credentials: heldByMember.get(m.id) ?? [],
  }));

  // What each role demands — normalised through the SDK parser so a stale enum
  // can never reach the rule. Drives credential_gap on manual placements.
  const roleRequiredCredentials: Record<string, CredentialKind[]> = {};
  for (const r of roleRows) {
    roleRequiredCredentials[r.id] = parseRequiredCredentials(r.required_credentials ?? []);
  }

  // Designated leads per role (rule 9) — from team memberships flagged key.
  const keyPersons: KeyPerson[] = membershipRows
    .filter((tm) => tm.is_key_person)
    .map((tm) => ({ member_id: tm.member_id, role_id: tm.role_id }));

  // A service inherits its required roles from its template, so the
  // unfilled-slot rule fires for templated services whose slots are still open.
  const reqByTemplate = new Map<string, RequirementRow[]>();
  for (const r of requirementRows) {
    const list = reqByTemplate.get(r.template_id) ?? [];
    list.push(r);
    reqByTemplate.set(r.template_id, list);
  }
  const serviceRequirements: RoleRequirement[] = [];
  for (const s of serviceRows) {
    if (!s.template_id) continue;
    for (const req of reqByTemplate.get(s.template_id) ?? []) {
      serviceRequirements.push({ service_id: s.id, role_id: req.role_id, quantity: req.quantity });
    }
  }

  const ctx: ConflictContext = {
    services: serviceRows.map((s) => ({
      id: s.id,
      starts_at: new Date(s.starts_at_utc),
    })),
    members: memberInfo,
    assignments: placed,
    requirements: serviceRequirements,
    keyPersons,
    roleRequiredCredentials,
    config: conflictConfig,
  };

  const requiredByServiceRole: Record<string, number> = {};
  for (const req of serviceRequirements) {
    requiredByServiceRole[`${req.service_id}|${req.role_id}`] = req.quantity;
  }

  const roleNames: Record<string, string> = Object.fromEntries(roleRows.map((r) => [r.id, r.name]));
  const serviceLabels: Record<string, string> = Object.fromEntries(
    gridServices.map((s) => [s.id, s.label]),
  );

  return {
    services: gridServices,
    roles: gridRoles,
    cells,
    conflicts: detectConflicts(ctx),
    memberNames,
    eligibleByRole,
    requiredByServiceRole,
    roleNames,
    serviceLabels,
    conflictContext: ctx,
  };
}
