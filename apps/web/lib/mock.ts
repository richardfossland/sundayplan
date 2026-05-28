/**
 * Mock church data for the dashboard demo. Entirely client-free of any
 * backend — it exists so the dashboard can run the real SDK engines
 * (autoFill + detectConflicts) against believable data and render the
 * result. Replaced by Supabase queries once Phase 1.2/1.3 land.
 *
 * Church: "Alta Frikirke". Upcoming service: Sunday 7 June 2026.
 */

import type { AssignmentStatus, Availability, SkillLevel } from "@sundayplan/shared";
import type {
  AutoFillSlot,
  ConflictContext,
  PlacedAssignment,
} from "@sundayplan/sdk";
import type { ScoringInputs } from "@sundayplan/sdk";

export const CHURCH_NAME = "Alta Frikirke";
export const DEMO_NOW = new Date("2026-06-01T08:00:00Z");

const SERVICE_ID = "svc-0607";
const SERVICE_DATE = new Date("2026-06-07T09:00:00Z"); // a Sunday
export const SERVICE_LABEL = "Sunday 7 June 2026 · 11:00";

export const ROLE_NAMES: Record<string, string> = {
  r_vocal: "Lead vocal",
  r_drums: "Drums",
  r_keys: "Keys",
  r_sound: "Sound",
  r_guitar: "Lead guitar",
};

interface Profile {
  id: string;
  name: string;
  joined_at: string;
  skill: SkillLevel;
  days_since: number | null;
  days_since_same_role: number | null;
  accepted_recent: number;
  target: number;
  consecutive: number;
  availability: Availability[];
  partner: boolean;
  trainer_paired: boolean;
}

function blocked(member_id: string, date: string, reason: string): Availability {
  return {
    id: `av-${member_id}`,
    member_id,
    kind: "specific",
    pattern: { dates: [date] },
    reason,
    reason_visibility: "planner",
  };
}

const PROFILES: Profile[] = [
  { id: "m-maria", name: "Maria Hansen", joined_at: "2019-02-01", skill: "lead", days_since: 21, days_since_same_role: 28, accepted_recent: 6, target: 2, consecutive: 1, availability: [], partner: true, trainer_paired: false },
  { id: "m-ingrid", name: "Ingrid Berg", joined_at: "2020-09-12", skill: "lead", days_since: 14, days_since_same_role: 21, accepted_recent: 5, target: 2, consecutive: 1, availability: [], partner: false, trainer_paired: false },
  { id: "m-erik", name: "Erik Dahl", joined_at: "2021-05-20", skill: "capable", days_since: 35, days_since_same_role: 35, accepted_recent: 3, target: 2, consecutive: 0, availability: [], partner: false, trainer_paired: false },
  { id: "m-lars", name: "Lars Olsen", joined_at: "2018-11-03", skill: "capable", days_since: 28, days_since_same_role: 28, accepted_recent: 4, target: 2, consecutive: 1, availability: [], partner: true, trainer_paired: false },
  { id: "m-sofie", name: "Sofie Lund", joined_at: "2022-01-15", skill: "capable", days_since: 7, days_since_same_role: 7, accepted_recent: 8, target: 2, consecutive: 2, availability: [blocked("m-sofie", "2026-06-07", "On holiday")], partner: false, trainer_paired: false },
  { id: "m-jonas", name: "Jonas Vik", joined_at: "2024-08-01", skill: "training", days_since: 10, days_since_same_role: null, accepted_recent: 2, target: 1, consecutive: 0, availability: [], partner: false, trainer_paired: true },
];

const BY_ID = new Map(PROFILES.map((p) => [p.id, p]));

export const MEMBER_NAMES: Record<string, string> = Object.fromEntries(
  PROFILES.map((p) => [p.id, p.name]),
);

function inputsFor(p: Profile, need: SkillLevel): ScoringInputs {
  return {
    candidate: {
      member_id: p.id,
      skill_level: p.skill,
      accepted_recent_count: p.accepted_recent,
      days_since_last_assignment: p.days_since,
      days_since_last_assignment_same_role: p.days_since_same_role,
      target_serves_per_month: p.target,
      availability: p.availability,
      consecutive_weeks_served: p.consecutive,
      has_frequent_partner_on_service: p.partner,
      has_trainer_paired: p.trainer_paired,
    },
    slot: { service_starts_at: SERVICE_DATE, role_skill_required: need },
  };
}

function candidatesFor(ids: string[], need: SkillLevel) {
  return ids.map((id) => {
    const p = BY_ID.get(id)!;
    return { member_id: id, joined_at: p.joined_at, inputs: inputsFor(p, need) };
  });
}

/** Open slots to auto-fill for the upcoming service. */
export function buildAutoFillSlots(): AutoFillSlot[] {
  return [
    { service_id: SERVICE_ID, role_id: "r_vocal", quantity: 1, candidates: candidatesFor(["m-maria", "m-erik", "m-jonas"], "lead") },
    { service_id: SERVICE_ID, role_id: "r_drums", quantity: 1, candidates: candidatesFor(["m-lars", "m-sofie"], "capable") },
    { service_id: SERVICE_ID, role_id: "r_keys", quantity: 1, candidates: candidatesFor(["m-ingrid", "m-maria"], "lead") },
    { service_id: SERVICE_ID, role_id: "r_sound", quantity: 2, candidates: candidatesFor(["m-sofie", "m-erik", "m-lars"], "capable") },
  ];
}

/**
 * A schedule snapshot deliberately seeded with problems so the conflict
 * panel has something to show: a double-book, a skill gap, a burnout run,
 * and an under-filled slot near its deadline.
 */
export function buildConflictContext(): ConflictContext {
  const sundays = ["2026-06-07", "2026-06-14", "2026-06-21", "2026-06-28"];
  const services = sundays.map((d, i) => ({ id: `s${i}`, starts_at: new Date(`${d}T09:00:00Z`) }));

  const assignments: PlacedAssignment[] = [
    // Maria double-booked in the same service (vocal + keys)
    { member_id: "m-maria", service_id: "s0", role_id: "r_vocal", skill_level: "lead", role_skill_required: "lead" },
    { member_id: "m-maria", service_id: "s0", role_id: "r_keys", skill_level: "lead", role_skill_required: "lead" },
    // Jonas (training) filling a lead-guitar slot → skill gap
    { member_id: "m-jonas", service_id: "s0", role_id: "r_guitar", skill_level: "training", role_skill_required: "lead" },
    // Lars on four Sundays in a row → burnout
    ...services.map((s) => ({ member_id: "m-lars", service_id: s.id, role_id: "r_drums", skill_level: "capable" as SkillLevel, role_skill_required: "capable" as SkillLevel })),
  ];

  const members = PROFILES.map((p) => ({
    id: p.id,
    display_name: p.name,
    availability: p.availability,
    max_assignments_per_month: 3,
  }));

  return {
    now: DEMO_NOW,
    services,
    members,
    assignments,
    // Sound needs 2 on the first service but nobody is on it yet → unfilled
    requirements: [{ service_id: "s0", role_id: "r_sound", quantity: 2 }],
  };
}

// ── Schedule grid (Phase 4.1) ────────────────────────────────────────────────

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
  service_id: string;
  role_id: string;
  member_id: string;
  status: AssignmentStatus;
}

const GRID_SERVICES: Array<GridService & { date: string }> = [
  { id: "g0", label: "7 Jun", date: "2026-06-07" },
  { id: "g1", label: "14 Jun", date: "2026-06-14" },
  { id: "g2", label: "21 Jun", date: "2026-06-21" },
  { id: "g3", label: "28 Jun", date: "2026-06-28" },
];

export const GRID_ROLES: GridRole[] = [
  { id: "r_vocal", name: "Lead vocal", skill: "lead" },
  { id: "r_keys", name: "Keys", skill: "lead" },
  { id: "r_drums", name: "Drums", skill: "capable" },
  { id: "r_guitar", name: "Lead guitar", skill: "lead" },
  { id: "r_sound", name: "Sound", skill: "capable" },
];

// A believable month of worship rota — with pending/declined states and a
// couple of gaps. Lars is on every Sunday on purpose (burnout + over-cap).
const GRID_CELLS: GridCell[] = [
  { service_id: "g0", role_id: "r_vocal", member_id: "m-maria", status: "accepted" },
  { service_id: "g0", role_id: "r_keys", member_id: "m-ingrid", status: "accepted" },
  { service_id: "g0", role_id: "r_drums", member_id: "m-lars", status: "accepted" },
  { service_id: "g0", role_id: "r_guitar", member_id: "m-jonas", status: "pending" },
  { service_id: "g0", role_id: "r_sound", member_id: "m-sofie", status: "declined" },

  { service_id: "g1", role_id: "r_vocal", member_id: "m-erik", status: "accepted" },
  { service_id: "g1", role_id: "r_keys", member_id: "m-maria", status: "pending" },
  { service_id: "g1", role_id: "r_drums", member_id: "m-lars", status: "accepted" },
  { service_id: "g1", role_id: "r_sound", member_id: "m-sofie", status: "accepted" },

  { service_id: "g2", role_id: "r_vocal", member_id: "m-maria", status: "accepted" },
  { service_id: "g2", role_id: "r_keys", member_id: "m-ingrid", status: "accepted" },
  { service_id: "g2", role_id: "r_drums", member_id: "m-lars", status: "accepted" },
  { service_id: "g2", role_id: "r_guitar", member_id: "m-jonas", status: "accepted" },
  { service_id: "g2", role_id: "r_sound", member_id: "m-erik", status: "pending" },

  { service_id: "g3", role_id: "r_vocal", member_id: "m-ingrid", status: "accepted" },
  { service_id: "g3", role_id: "r_drums", member_id: "m-lars", status: "accepted" },
  { service_id: "g3", role_id: "r_guitar", member_id: "m-jonas", status: "pending" },
  { service_id: "g3", role_id: "r_sound", member_id: "m-sofie", status: "accepted" },
];

export function buildScheduleGrid(): { services: GridService[]; roles: GridRole[]; cells: GridCell[] } {
  return {
    services: GRID_SERVICES.map(({ id, label }) => ({ id, label })),
    roles: GRID_ROLES,
    cells: GRID_CELLS,
  };
}

/** Conflict context for the grid — declined/removed cells are excluded. */
export function buildScheduleConflictContext(): ConflictContext {
  const roleSkill = new Map(GRID_ROLES.map((r) => [r.id, r.skill]));
  const active = GRID_CELLS.filter((c) => c.status !== "declined" && c.status !== "removed");

  const assignments: PlacedAssignment[] = active.map((c) => ({
    member_id: c.member_id,
    service_id: c.service_id,
    role_id: c.role_id,
    skill_level: BY_ID.get(c.member_id)!.skill,
    role_skill_required: roleSkill.get(c.role_id)!,
  }));

  return {
    now: DEMO_NOW,
    services: GRID_SERVICES.map((s) => ({ id: s.id, starts_at: new Date(`${s.date}T09:00:00Z`) })),
    members: PROFILES.map((p) => ({ id: p.id, display_name: p.name, availability: p.availability, max_assignments_per_month: 3 })),
    assignments,
    // The nearest service needs sound covered, but Sofie declined → unfilled
    requirements: [{ service_id: "g0", role_id: "r_sound", quantity: 1 }],
  };
}
