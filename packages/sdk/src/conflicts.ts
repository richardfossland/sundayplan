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
 * Rules implemented (the plan's full Phase 4.2 list):
 *   1 double_booking         (hard)  — member assigned 2+ times in one service
 *   2 unavailable            (hard)  — assigned during declared unavailability
 *   3 same_day               (soft)  — assigned to 2+ services the same day
 *   4 over_max_per_month     (soft)  — exceeds the member's monthly cap
 *   5 family_conflict        (soft)  — 2+ of one household serve the same service
 *   6 skill_gap              (soft)  — member's skill is below the role's need
 *   7 unfilled_near_deadline (soft)  — required slot still open near the date
 *   8 consecutive_sundays    (soft)  — too many Sundays in a row
 *   9 key_person_unavailable (soft)  — every lead for a required role is away
 *  10 credential_gap         (hard)  — member lacks a credential the role requires
 *  11 min_rest_window        (hard)  — assigned again before min_rest_days elapsed
 *
 * Rule 11 is the HARD, configurable counterpart to the soft consecutive-Sundays
 * heuristic: it forbids assigning a volunteer to a service when fewer than
 * `config.min_rest_days` days separate it from their nearest OTHER assignment
 * (in either direction). It is OFF by default (`min_rest_days: 0`), so it never
 * fires — and never changes existing behaviour — until a church opts in. Unlike
 * rule 8 it counts every assignment (not only Sundays) and across services, so a
 * 6-day window also forbids serving Sat + the next Fri, or twice the same day.
 *
 * Rule 5 keys off an opaque `household_id` grouping label on the member; rule 9
 * off a `keyPersons` list (member is a designated lead for a role) — both
 * supplied by the data layer. A rule simply no-ops when its inputs are absent.
 *
 * Rule 10 keys off `member.credentials` (the certifications a member holds) and
 * `roleRequiredCredentials` (the set each role demands). It is the *enforcement*
 * counterpart to the auto-fill credential gate (which merely keeps an
 * uncredentialed member out of the candidate pool): when a planner places one
 * by hand, this surfaces the gap as a hard conflict. Both no-op when absent.
 *
 * Rule 1's "overlapping time slots" nuance is approximated as "same service":
 * absolute item start times aren't modeled yet, so we flag any same-service
 * multi-assignment (dismissable by the planner) rather than miss a true clash.
 */

import type { Availability, SkillLevel } from "@sundayplan/shared";
import { isUnavailable, isoDate, utcWeekday } from "@sundayplan/shared";
import { missingCredentials, type CredentialKind, type MemberCredential } from "./credentials";

export type ConflictSeverity = "hard" | "soft";

export type ConflictRule =
  | "double_booking"
  | "unavailable"
  | "same_day"
  | "over_max_per_month"
  | "family_conflict"
  | "skill_gap"
  | "unfilled_near_deadline"
  | "consecutive_sundays"
  | "key_person_unavailable"
  | "credential_gap"
  | "min_rest_window";

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
  /** opaque household grouping label; members sharing it trip rule 5 */
  household_id?: string | null;
  /** certifications the member holds — drives rule 10 (credential_gap) */
  credentials?: MemberCredential[];
}

/** A role requirement for a service — drives unfilled-slot detection. */
export interface RoleRequirement {
  service_id: string;
  role_id: string;
  quantity: number;
}

/** A member designated as a lead for a role — drives rule 9. */
export interface KeyPerson {
  member_id: string;
  role_id: string;
}

export interface ConflictConfig {
  /** Warn if a required slot is unfilled within this many days of the service. */
  unfilled_warn_days: number;
  /** Warn if a member serves more than this many consecutive Sundays. */
  max_consecutive_sundays: number;
  /**
   * HARD rest window: forbid assigning a member again when fewer than this many
   * days separate two of their assignments. `0` (the default) disables the rule
   * entirely — existing behaviour is unchanged until a church opts in.
   */
  min_rest_days: number;
}

export const DEFAULT_CONFLICT_CONFIG: ConflictConfig = {
  unfilled_warn_days: 7,
  max_consecutive_sundays: 3,
  min_rest_days: 0,
};

export interface ConflictContext {
  services: ServiceInfo[];
  assignments: PlacedAssignment[];
  members: MemberInfo[];
  requirements?: RoleRequirement[];
  /** designated leads per role — supplied for rule 9 (key_person_unavailable) */
  keyPersons?: KeyPerson[];
  /** credentials each role demands, by role id — supplied for rule 10 */
  roleRequiredCredentials?: Record<string, CredentialKind[]>;
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
    ...ruleFamilyConflict(ctx, memberById),
    ...ruleSkillGap(ctx),
    ...ruleUnfilledNearDeadline(ctx, serviceById, now, cfg),
    ...ruleConsecutiveSundays(ctx, serviceById, cfg),
    ...ruleKeyPersonUnavailable(ctx, serviceById, memberById),
    ...ruleCredentialGap(ctx, memberById, now),
    ...ruleMinRestWindow(ctx, serviceById, cfg),
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

// ── Rule 5: two of one household serve the same service (soft) ──────────────
function ruleFamilyConflict(
  ctx: ConflictContext,
  memberById: Map<string, MemberInfo>,
): Conflict[] {
  // service → household → set of member ids assigned there
  const byServiceHousehold = new Map<string, Map<string, Set<string>>>();
  for (const a of ctx.assignments) {
    const household = memberById.get(a.member_id)?.household_id;
    if (!household) continue;
    let households = byServiceHousehold.get(a.service_id);
    if (!households) byServiceHousehold.set(a.service_id, (households = new Map()));
    let members = households.get(household);
    if (!members) households.set(household, (members = new Set()));
    members.add(a.member_id);
  }
  const out: Conflict[] = [];
  for (const [service_id, households] of byServiceHousehold) {
    for (const members of households.values()) {
      if (members.size < 2) continue;
      const ids = [...members];
      // One conflict per member so the grid can mark each cell.
      for (const member_id of ids) {
        const others = ids
          .filter((id) => id !== member_id)
          .map((id) => memberById.get(id)?.display_name ?? id);
        out.push({
          rule: "family_conflict",
          severity: "soft",
          member_id,
          service_id,
          message: `Same household as ${others.join(", ")}, both serving this service`,
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

// ── Rule 9: every lead for a required role is unavailable (soft) ────────────
function ruleKeyPersonUnavailable(
  ctx: ConflictContext,
  serviceById: Map<string, ServiceInfo>,
  memberById: Map<string, MemberInfo>,
): Conflict[] {
  if (!ctx.keyPersons || ctx.keyPersons.length === 0 || !ctx.requirements) return [];
  const keysByRole = new Map<string, string[]>();
  for (const kp of ctx.keyPersons) {
    const list = keysByRole.get(kp.role_id) ?? [];
    list.push(kp.member_id);
    keysByRole.set(kp.role_id, list);
  }
  const out: Conflict[] = [];
  for (const req of ctx.requirements) {
    const service = serviceById.get(req.service_id);
    if (!service) continue;
    const keys = keysByRole.get(req.role_id);
    if (!keys || keys.length === 0) continue;
    const anyAvailable = keys.some((id) => {
      const m = memberById.get(id);
      return m != null && !isUnavailable(m.availability, service.starts_at);
    });
    if (!anyAvailable) {
      out.push({
        rule: "key_person_unavailable",
        severity: "soft",
        service_id: req.service_id,
        role_id: req.role_id,
        message: `All ${keys.length} designated lead(s) for this role are unavailable on ${isoDate(service.starts_at)}`,
      });
    }
  }
  return out;
}

// ── Rule 10: member lacks a credential the role requires (hard) ─────────────
function ruleCredentialGap(
  ctx: ConflictContext,
  memberById: Map<string, MemberInfo>,
  now: Date,
): Conflict[] {
  const required = ctx.roleRequiredCredentials;
  if (!required) return [];
  const out: Conflict[] = [];
  for (const a of ctx.assignments) {
    const need = required[a.role_id];
    if (!need || need.length === 0) continue;
    const held = memberById.get(a.member_id)?.credentials ?? [];
    const missing = missingCredentials(need, held, now);
    if (missing.length === 0) continue;
    out.push({
      rule: "credential_gap",
      severity: "hard",
      member_id: a.member_id,
      service_id: a.service_id,
      role_id: a.role_id,
      message: `Missing required credential(s): ${missing.join(", ")}`,
    });
  }
  return out;
}

// ── Rule 11: hard minimum rest window between assignments (hard) ─────────────
function ruleMinRestWindow(
  ctx: ConflictContext,
  serviceById: Map<string, ServiceInfo>,
  cfg: ConflictConfig,
): Conflict[] {
  if (cfg.min_rest_days <= 0) return []; // disabled → no behaviour change.

  // member → list of { service_id, time } they're assigned to (one per service;
  // two roles in the SAME service are not a rest-window violation against each
  // other — that is double_booking's job, and the gap would be 0 spuriously).
  const byMember = new Map<string, Map<string, number>>();
  for (const a of ctx.assignments) {
    const service = serviceById.get(a.service_id);
    if (!service) continue;
    let svcs = byMember.get(a.member_id);
    if (!svcs) byMember.set(a.member_id, (svcs = new Map()));
    svcs.set(a.service_id, service.starts_at.getTime());
  }

  const out: Conflict[] = [];
  for (const [member_id, svcs] of byMember) {
    // Sort the member's distinct services chronologically (stable on ties by id)
    // and flag the LATER service of any adjacent pair closer than the window.
    const ordered = [...svcs.entries()].sort(
      (a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    );
    for (let i = 1; i < ordered.length; i++) {
      const prevT = ordered[i - 1][1];
      const [curId, curT] = ordered[i];
      const gapDays = (curT - prevT) / MS_PER_DAY;
      if (gapDays < cfg.min_rest_days) {
        out.push({
          rule: "min_rest_window",
          severity: "hard",
          member_id,
          service_id: curId,
          message:
            `Only ${formatGap(gapDays)} since serving on ${isoDate(new Date(prevT))} ` +
            `— the rest window is ${cfg.min_rest_days} day(s)`,
        });
      }
    }
  }
  return out;
}

/** Human-friendly gap, e.g. "0 days", "3 days", "1.5 days". */
function formatGap(gapDays: number): string {
  const rounded = Math.round(gapDays * 10) / 10;
  const n = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${n} day${rounded === 1 ? "" : "s"}`;
}

/**
 * Shared, pure rest-window predicate the auto-fill orchestrator reuses so its
 * gate and rule 11 agree exactly. Returns true iff placing an assignment on
 * `candidateTime` would sit fewer than `minRestDays` from ANY of the member's
 * `otherTimes` (existing or already-proposed-this-run commitments). With
 * `minRestDays <= 0` it is always false (the rule is off). An exact-same-instant
 * match (the same service) is excluded — that is double-booking, not a rest gap.
 */
export function violatesRestWindow(
  candidateTime: number,
  otherTimes: number[],
  minRestDays: number,
): boolean {
  if (minRestDays <= 0) return false;
  for (const t of otherTimes) {
    if (t === candidateTime) continue; // same service instant → not a rest gap
    const gapDays = Math.abs(candidateTime - t) / MS_PER_DAY;
    if (gapDays < minRestDays) return true;
  }
  return false;
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
