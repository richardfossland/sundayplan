/**
 * Auto-fill adapter — turns the church's live schedule into the SDK's
 * AutoFillSlot[] so the deterministic `autoFill` orchestrator can propose a
 * rota draft. Builds one slot per OPEN (service, role) cell, with candidates
 * drawn from the members trained for that role, each carrying real scoring
 * inputs (skill-in-role, accepted history, availability). All reads run under
 * the planner's RLS.
 *
 * History-derived signals (recent count, days-since, consecutive weeks) come
 * from past accepted assignments; with only upcoming services seeded they are
 * mostly zero/null, so the first draft ranks chiefly on skill match and target
 * frequency — and sharpens automatically as real history accrues.
 */
import {
  isBlockedByCredentials,
  type AutoFillSlot,
  type CredentialKind,
  type MemberCredential,
} from "@sundayplan/sdk";
import type { Availability, SkillLevel } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/server";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

interface ServiceRow {
  id: string;
  starts_at_utc: string;
}
interface RoleRow {
  id: string;
  skill_required: SkillLevel;
  required_credentials: CredentialKind[] | null;
}
interface AssignmentRow {
  service_id: string;
  role_id: string;
  member_id: string;
  status: string;
}
interface MemberRow {
  id: string;
  joined_at: string | null;
  target_serves_per_month: number | null;
  availability: Availability[] | null;
}
interface MembershipRow {
  member_id: string;
  role_id: string;
  skill_level: SkillLevel;
}

/** Get the array/set at `key`, creating an empty one on first touch. */
function bucket<K, V>(map: Map<K, V[]>, key: K): V[] {
  let v = map.get(key);
  if (!v) map.set(key, (v = []));
  return v;
}
function bucketSet<K, V>(map: Map<K, Set<V>>, key: K): Set<V> {
  let v = map.get(key);
  if (!v) map.set(key, (v = new Set<V>()));
  return v;
}

/** Trailing run of consecutive ISO-ish weeks (latest-served backwards). */
function consecutiveWeeks(dates: Date[]): number {
  if (dates.length === 0) return 0;
  const weeks = [...new Set(dates.map((d) => Math.floor(d.getTime() / WEEK_MS)))].sort(
    (a, b) => b - a,
  );
  let run = 1;
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i] === weeks[i - 1] - 1) run++;
    else break;
  }
  return run;
}

export async function buildAutoFillSlots(now: Date = new Date()): Promise<AutoFillSlot[]> {
  const supabase = await createClient();
  const [services, roles, assignments, members, memberships, credentials] = await Promise.all([
    supabase.from("service").select("id, starts_at_utc").order("starts_at_utc"),
    supabase.from("role").select("id, skill_required, required_credentials").order("name"),
    supabase.from("assignment").select("service_id, role_id, member_id, status"),
    supabase.from("member").select(
      "id, joined_at, target_serves_per_month, availability(id, member_id, kind, pattern, reason, reason_visibility)",
    ),
    supabase.from("team_membership").select("member_id, role_id, skill_level"),
    supabase.from("member_credential").select("member_id, kind, status, expires_at"),
  ]);
  for (const r of [services, roles, assignments, members, memberships]) {
    if (r.error) throw r.error;
  }

  const serviceRows = (services.data ?? []) as unknown as ServiceRow[];
  const roleRows = (roles.data ?? []) as unknown as RoleRow[];
  const assignmentRows = (assignments.data ?? []) as unknown as AssignmentRow[];
  const memberRows = (members.data ?? []) as unknown as MemberRow[];
  const membershipRows = (memberships.data ?? []) as unknown as MembershipRow[];

  const serviceStart = new Map(serviceRows.map((s) => [s.id, new Date(s.starts_at_utc)]));
  const roleSkill = new Map(roleRows.map((r) => [r.id, r.skill_required]));
  const roleRequiredCreds = new Map(roleRows.map((r) => [r.id, r.required_credentials ?? []]));
  const memberById = new Map(memberRows.map((m) => [m.id, m]));

  // Held credentials per member, for the gate. Missing table (pre-migration) →
  // empty, so gating is a no-op until 0011 lands.
  const credentialRows = (credentials.data ?? []) as unknown as ({ member_id: string } & MemberCredential)[];
  const heldByMember = new Map<string, MemberCredential[]>();
  for (const c of credentialRows) {
    bucket(heldByMember, c.member_id).push({ kind: c.kind, status: c.status, expires_at: c.expires_at });
  }
  const skillByMemberRole = new Map(
    membershipRows.map((tm) => [`${tm.member_id}:${tm.role_id}`, tm.skill_level]),
  );

  // Eligible (trained) members per role.
  const eligibleByRole = new Map<string, string[]>();
  for (const tm of membershipRows) {
    const list = eligibleByRole.get(tm.role_id) ?? [];
    list.push(tm.member_id);
    eligibleByRole.set(tm.role_id, list);
  }

  // Active placements per service (block double-booking + find filled cells).
  const assignedInService = new Map<string, Set<string>>();
  const filledCell = new Set<string>(); // `${service}:${role}`
  const trainerInService = new Set<string>(); // service ids with a trainer present
  // Past accepted history per member, for the scoring signals.
  const acceptedAny = new Map<string, Date[]>();
  const acceptedByRole = new Map<string, Date[]>(); // key `${member}:${role}`

  for (const a of assignmentRows) {
    const active = a.status !== "declined" && a.status !== "removed";
    if (active) {
      bucketSet(assignedInService, a.service_id).add(a.member_id);
      filledCell.add(`${a.service_id}:${a.role_id}`);
      if ((skillByMemberRole.get(`${a.member_id}:${a.role_id}`) ?? "capable") === "trainer") {
        trainerInService.add(a.service_id);
      }
    }
    if (a.status === "accepted") {
      const when = serviceStart.get(a.service_id);
      if (when && when.getTime() < now.getTime()) {
        bucket(acceptedAny, a.member_id).push(when);
        bucket(acceptedByRole, `${a.member_id}:${a.role_id}`).push(when);
      }
    }
  }

  const ninetyAgo = now.getTime() - 90 * DAY_MS;
  const daysSince = (dates: Date[] | undefined): number | null => {
    if (!dates || dates.length === 0) return null;
    const latest = Math.max(...dates.map((d) => d.getTime()));
    return Math.floor((now.getTime() - latest) / DAY_MS);
  };

  const slots: AutoFillSlot[] = [];
  for (const svc of serviceRows) {
    const taken = assignedInService.get(svc.id) ?? new Set<string>();
    const startsAt = serviceStart.get(svc.id)!;
    for (const role of roleRows) {
      if (filledCell.has(`${svc.id}:${role.id}`)) continue; // already covered
      const requiredCreds = roleRequiredCreds.get(role.id) ?? [];
      const eligible = (eligibleByRole.get(role.id) ?? []).filter(
        (id) =>
          !taken.has(id) &&
          // Credential gate: skip anyone missing a current required credential.
          !isBlockedByCredentials(requiredCreds, heldByMember.get(id) ?? [], now),
      );
      if (eligible.length === 0) continue; // no candidate → skip (nothing to propose)
      const required = roleSkill.get(role.id) ?? "capable";
      slots.push({
        service_id: svc.id,
        role_id: role.id,
        quantity: 1,
        candidates: eligible.map((memberId) => {
          const m = memberById.get(memberId);
          const skill = skillByMemberRole.get(`${memberId}:${role.id}`) ?? "capable";
          const anyDates = acceptedAny.get(memberId);
          return {
            member_id: memberId,
            joined_at: m?.joined_at ?? null,
            inputs: {
              candidate: {
                member_id: memberId,
                skill_level: skill,
                accepted_recent_count: (anyDates ?? []).filter((d) => d.getTime() >= ninetyAgo)
                  .length,
                days_since_last_assignment: daysSince(anyDates),
                days_since_last_assignment_same_role: daysSince(
                  acceptedByRole.get(`${memberId}:${role.id}`),
                ),
                target_serves_per_month: m?.target_serves_per_month ?? 2,
                availability: m?.availability ?? [],
                consecutive_weeks_served: consecutiveWeeks(anyDates ?? []),
                has_frequent_partner_on_service: false, // partner data not modelled
                has_trainer_paired: skill === "training" && trainerInService.has(svc.id),
              },
              slot: { service_starts_at: startsAt, role_skill_required: required },
            },
          };
        }),
      });
    }
  }
  return slots;
}
