/**
 * Conflict-detection rule engine — deterministic, pure functions.
 *
 * Prevents double-bookings and surfaces scheduling smells. Two modes:
 *  - `detectConflicts(ctx)` runs every rule over a whole schedule snapshot.
 *  - `previewCandidate(ctx, candidate)` checks one hypothetical assignment,
 *    returning only the conflicts that would involve that member.
 *
 * The engine takes an explicit, DB-free `ConflictContext`, so it is trivially
 * unit-testable and is the same logic the schedule view (Phase 4.1) and the
 * auto-fill UX (Phase 5.2) call. All date reasoning is UTC-based, consistent
 * with the scoring engine.
 *
 * Rules implemented (the plan's Phase 4.2 list, computable from current schema):
 *   1 double_booking         (hard)  — member assigned 2+ times in one service
 *   2 unavailable            (hard)  — assigned during declared unavailability
 *   3 same_day               (soft)  — assigned to 2+ services the same day
 *   4 over_max_per_month     (soft)  — exceeds the member's monthly cap
 *   6 skill_gap              (soft)  — member's skill is below the role's need
 *   7 unfilled_near_deadline (soft)  — required slot still open near the date
 *   8 consecutive_sundays    (soft)  — too many Sundays in a row
 *
 * Deferred (need schema additions, intentionally not implemented yet):
 *   5 family_conflict         — needs a member↔member relationship field
 *   9 key_person_unavailable  — needs a "designated lead" marker per role/team
 *
 * Rule 1's "overlapping time slots" nuance is approximated as "same service":
 * absolute item start times aren't modeled yet, so we flag any same-service
 * multi-assignment (dismissable by the planner) rather than miss a true clash.
 */

import type { Availability, SkillLevel } from "@sundayplan/shared";
import { isUnavailable, isoDate, utcWeekday } from "@sundayplan/shared";

export type ConflictSeverity = "hard" | "soft";

export type ConflictRule =
  | "double_booking"
  | "unavailable"
  | "same_day"
  | "over_max_per_month"
  | "skill_gap"
  | "unfilled_near_deadline"
  | "consecutive_sundays";

export interface Conflict {
  rule: ConflictRule;
  severity: ConflictSeverity;
  message: string;
  member_id?: string;
  service_id?: string;
  role_id?: string;
}

/** A placed (or proposed) assignment, denormalized for the engine. */
export interface PlacedAssignment {
  member_id: string;
  service_id: string;
  role_id: string;
  /** the member's skill level in this role */
  skill_level: SkillLevel;
  /** the skill the role demands */
  role_skill_required: SkillLevel;
}

export interface ServiceInfo {
  id: string;
  starts_at: Date;
}

export interface MemberInfo {
  id: string;
  display_name?: string;
  availability: Availability[];
  /** church default unless overridden per member */
  max_assignments_per_month: number;
}

/** A role requirement for a service — drives unfilled-slot detection. */
export interface RoleRequirement {
  service_id: string;
  role_id: string;
  quantity: number;
}

export interface ConflictConfig {
  /** Warn if a required slot is unfilled within this many days of the service. */
  unfilled_warn_days: number;
  /** Warn if a member serves more than this many consecutive Sundays. */
  max_consecutive_sundays: number;
}

export const DEFAULT_CONFLICT_CONFIG: ConflictConfig = {
  unfilled_warn_days: 7,
  max_consecutive_sundays: 3,
};

export interface ConflictContext {
  services: ServiceInfo[];
  assignments: PlacedAssignment[];
  members: MemberInfo[];
  requirements?: RoleRequirement[];
  config?: Partial<ConflictConfig>;
  /** "today", for deadline-based rules. Defaults to `new Date()`. */
  now?: Date;
}

const SKILL_ORDER: Record<SkillLevel, number> = {
  training: 0,
  capable: 1,
  lead: 2,
  trainer: 3,
};

const MS_PER_DAY = 86_400_000;

/** Run every rule over the schedule snapshot. */
export function detectConflicts(ctx: ConflictContext): Conflict[] {
  const cfg = { ...DEFAULT_CONFLICT_CONFIG, ...(ctx.config ?? {}) };
  const now = ctx.now ?? new Date();
  const serviceById = new Map(ctx.services.map((s) => [s.id, s]));
  const memberById = new Map(ctx.members.map((m) => [m.id, m]));

  return [
    ...ruleDoubleBooking(ctx),
    ...ruleUnavailable(ctx, serviceById, memberById),
    ...ruleSameDay(ctx, serviceById),
    ...ruleOverMaxPerMonth(ctx, serviceById, memberById),
    ...ruleSkillGap(ctx),
    ...ruleUnfilledNearDeadline(ctx, serviceById, now, cfg),
    ...ruleConsecutiveSundays(ctx, serviceById, cfg),
  ];
}

/**
 * Check one hypothetical assignment against the current schedule. Returns only
 * the conflicts that mention the candidate member (so the schedule UI can show
 * inline warnings before the planner commits the assignment).
 */
export function previewCandidate(
  ctx: ConflictContext,
  candidate: PlacedAssignment,
): Conflict[] {
  const augmented: ConflictContext = {
    ...ctx,
    assignments: [...ctx.assignments, candidate],
  };
  return detectConflicts(augmented).filter(
    (c) => c.member_id === candidate.member_id,
  );
}

// ── Rule 1: double booking (hard) ───────────────────────────────────────────
function ruleDoubleBooking(ctx: ConflictContext): Conflict[] {
  const counts = new Map<string, number>(); // `${member}|${service}` → count
  for (const a of ctx.assignments) {
    const key = `${a.member_id}|${a.service_id}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: Conflict[] = [];
  for (const [key, count] of counts) {
    if (count > 1) {
      const [member_id, service_id] = key.split("|");
      out.push({
        rule: "double_booking",
        severity: "hard",
        member_id,
        service_id,
        message: `Assigned to ${count} roles in the same service — verify they don't overlap in time`,
      });
    }
  }
  return out;
}

// ── Rule 2: assigned during unavailability (hard) ───────────────────────────
function ruleUnavailable(
  ctx: ConflictContext,
  serviceById: Map<string, ServiceInfo>,
  memberById: Map<string, MemberInfo>,
): Conflict[] {
  const out: Conflict[] = [];
  for (const a of ctx.assignments) {
    const service = serviceById.get(a.service_id);
    const member = memberById.get(a.member_id);
    if (!service || !member) continue;
    if (isUnavailable(member.availability, service.starts_at)) {
      out.push({
        rule: "unavailable",
        severity: "hard",
        member_id: a.member_id,
        service_id: a.service_id,
        role_id: a.role_id,
        message: `Assigned on ${isoDate(service.starts_at)} but marked unavailable`,
      });
    }
  }
  return out;
}

// ── Rule 3: two services on the same day (soft) ─────────────────────────────
function ruleSameDay(
  ctx: ConflictContext,
  serviceById: Map<string, ServiceInfo>,
): Conflict[] {
  // member → day → set of service ids
  const byMemberDay = new Map<string, Map<string, Set<string>>>();
  for (const a of ctx.assignments) {
    const service = serviceById.get(a.service_id);
    if (!service) continue;
    const day = isoDate(service.starts_at);
    let days = byMemberDay.get(a.member_id);
    if (!days) byMemberDay.set(a.member_id, (days = new Map()));
    let svcs = days.get(day);
    if (!svcs) days.set(day, (svcs = new Set()));
    svcs.add(a.service_id);
  }
  const out: Conflict[] = [];
  for (const [member_id, days] of byMemberDay) {
    for (const [day, svcs] of days) {
      if (svcs.size > 1) {
        out.push({
          rule: "same_day",
          severity: "soft",
          member_id,
          message: `Assigned to ${svcs.size} services on ${day}`,
        });
      }
    }
  }
  return out;
}

// ── Rule 4: over the monthly cap (soft) ─────────────────────────────────────
function ruleOverMaxPerMonth(
  ctx: ConflictContext,
  serviceById: Map<string, ServiceInfo>,
  memberById: Map<string, MemberInfo>,
): Conflict[] {
  // member → month(YYYY-MM) → count
  const byMemberMonth = new Map<string, Map<string, number>>();
  for (const a of ctx.assignments) {
    const service = serviceById.get(a.service_id);
    if (!service) continue;
    const month = isoDate(service.starts_at).slice(0, 7);
    let months = byMemberMonth.get(a.member_id);
    if (!months) byMemberMonth.set(a.member_id, (months = new Map()));
    months.set(month, (months.get(month) ?? 0) + 1);
  }
  const out: Conflict[] = [];
  for (const [member_id, months] of byMemberMonth) {
    const max = memberById.get(member_id)?.max_assignments_per_month;
    if (max == null) continue;
    for (const [month, count] of months) {
      if (count > max) {
        out.push({
          rule: "over_max_per_month",
          severity: "soft",
          member_id,
          message: `${count} assignments in ${month} exceeds the cap of ${max}`,
        });
      }
    }
  }
  return out;
}

// ── Rule 6: skill below the role's requirement (soft) ───────────────────────
function ruleSkillGap(ctx: ConflictContext): Conflict[] {
  const out: Conflict[] = [];
  for (const a of ctx.assignments) {
    if (SKILL_ORDER[a.skill_level] < SKILL_ORDER[a.role_skill_required]) {
      out.push({
        rule: "skill_gap",
        severity: "soft",
        member_id: a.member_id,
        service_id: a.service_id,
        role_id: a.role_id,
        message: `Filled at "${a.skill_level}" level but the role needs "${a.role_skill_required}"`,
      });
    }
  }
  return out;
}

// ── Rule 7: required slot unfilled near the deadline (soft) ──────────────────
function ruleUnfilledNearDeadline(
  ctx: ConflictContext,
  serviceById: Map<string, ServiceInfo>,
  now: Date,
  cfg: ConflictConfig,
): Conflict[] {
  if (!ctx.requirements) return [];
  const filled = new Map<string, number>(); // `${service}|${role}` → count
  for (const a of ctx.assignments) {
    const key = `${a.service_id}|${a.role_id}`;
    filled.set(key, (filled.get(key) ?? 0) + 1);
  }
  const out: Conflict[] = [];
  for (const req of ctx.requirements) {
    const service = serviceById.get(req.service_id);
    if (!service) continue;
    const daysOut = (service.starts_at.getTime() - now.getTime()) / MS_PER_DAY;
    if (daysOut < 0 || daysOut > cfg.unfilled_warn_days) continue;
    const have = filled.get(`${req.service_id}|${req.role_id}`) ?? 0;
    if (have < req.quantity) {
      out.push({
        rule: "unfilled_near_deadline",
        severity: "soft",
        service_id: req.service_id,
        role_id: req.role_id,
        message: `${have}/${req.quantity} filled with ${Math.ceil(daysOut)} day(s) to go`,
      });
    }
  }
  return out;
}

// ── Rule 8: too many consecutive Sundays (soft) ─────────────────────────────
function ruleConsecutiveSundays(
  ctx: ConflictContext,
  serviceById: Map<string, ServiceInfo>,
  cfg: ConflictConfig,
): Conflict[] {
  // member → set of Sunday ISO dates they serve
  const byMember = new Map<string, Set<string>>();
  for (const a of ctx.assignments) {
    const service = serviceById.get(a.service_id);
    if (!service || utcWeekday(service.starts_at) !== "sunday") continue;
    let set = byMember.get(a.member_id);
    if (!set) byMember.set(a.member_id, (set = new Set()));
    set.add(isoDate(service.starts_at));
  }
  const out: Conflict[] = [];
  for (const [member_id, set] of byMember) {
    const run = longestConsecutiveSundayRun([...set]);
    if (run > cfg.max_consecutive_sundays) {
      out.push({
        rule: "consecutive_sundays",
        severity: "soft",
        member_id,
        message: `Serving ${run} Sundays in a row (cap ${cfg.max_consecutive_sundays})`,
      });
    }
  }
  return out;
}

/** Longest run of Sundays spaced exactly 7 days apart. */
function longestConsecutiveSundayRun(isoDates: string[]): number {
  if (isoDates.length === 0) return 0;
  const times = isoDates
    .map((d) => new Date(`${d}T00:00:00Z`).getTime())
    .sort((a, b) => a - b);
  let longest = 1;
  let current = 1;
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] === 7 * MS_PER_DAY) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }
  return longest;
}
