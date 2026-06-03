/**
 * End-to-end scheduling scenario (Phase 5 integration verification).
 *
 * The autofill, conflict, and swap engines each have thorough isolated unit
 * tests. This file is the *integration* harness: it wires all three together
 * against one realistic, hand-authored church scenario and asserts they behave
 * sensibly as a whole — the cross-slot, cross-service interactions the unit
 * tests don't reach.
 *
 * The scenario is "Grace Church, September 2026" — four Sundays, three teams
 * (worship / sound / hospitality), and an eight-person roster with varied skill
 * levels, join dates, and real-world availability constraints (a recurring
 * block, a holiday range, a one-off). It exercises:
 *   - a multi-service schedule across 4 Sundays
 *   - multi-slot roles (2 vocalists)
 *   - availability hard-gating during auto-fill
 *   - family (household) conflicts and key-person coverage
 *   - swap-finding that ranks replacements and surfaces soft warnings
 *
 * Everything is pure + in-memory: no Supabase, no network, no clock — `now` and
 * all dates are pinned, so the whole file is deterministic and snapshot-stable.
 */

import { describe, expect, it } from "vitest";
import type { Availability, SkillLevel } from "@sundayplan/shared";
import { autoFill, type AutoFillSlot } from "./autofill";
import {
  detectConflicts,
  type ConflictContext,
  type KeyPerson,
  type MemberInfo,
  type PlacedAssignment,
  type RoleRequirement,
  type ServiceInfo,
} from "./conflicts";
import { eligibleReplacements, type ReplacementCandidate } from "./swap";
import { scoreCandidate, type ScoringInputs } from "./scoring";

// ── The four Sundays of September 2026 (all verified UTC Sundays) ────────────
const SUNDAYS = {
  sep06: new Date("2026-09-06T11:00:00Z"),
  sep13: new Date("2026-09-13T11:00:00Z"),
  sep20: new Date("2026-09-20T11:00:00Z"),
  sep27: new Date("2026-09-27T11:00:00Z"),
} as const;

// "Today" sits before the first Sunday so deadline-based rules can fire.
const NOW = new Date("2026-09-01T08:00:00Z");

const SERVICES: ServiceInfo[] = [
  { id: "svc-sep06", starts_at: SUNDAYS.sep06 },
  { id: "svc-sep13", starts_at: SUNDAYS.sep13 },
  { id: "svc-sep20", starts_at: SUNDAYS.sep20 },
  { id: "svc-sep27", starts_at: SUNDAYS.sep27 },
];

// ── Roles (one per team, plus a multi-slot vocalist role) ────────────────────
const ROLE = {
  vocals: "role-vocals", // worship — needs 2, lead-level
  guitar: "role-guitar", // worship — needs 1, capable
  sound: "role-sound", // sound — needs 1, capable
  coffee: "role-coffee", // hospitality — needs 1, training ok
} as const;

const ROLE_SKILL: Record<string, SkillLevel> = {
  [ROLE.vocals]: "lead",
  [ROLE.guitar]: "capable",
  [ROLE.sound]: "capable",
  [ROLE.coffee]: "training",
};

// ── The roster ───────────────────────────────────────────────────────────────
//
// Skill per (member, role). Members not listed for a role simply aren't
// candidates for it. The Olsens (dad + daughter) share a household so they trip
// the family-conflict rule if scheduled together.
interface Member {
  id: string;
  display_name: string;
  joined_at: string | null;
  household_id?: string | null;
  /** church monthly cap, kept generous so 4 weeks rarely trips it */
  max_per_month: number;
  /** the member's skill in each role they can serve */
  skills: Partial<Record<string, SkillLevel>>;
  availability: Availability[];
}

/**
 * A recurring weekday block. Exercised below by Gustav, who has a standing
 * Saturday commitment — proving recurring availability is matched by *weekday*
 * (so it correctly leaves his Sunday eligibility untouched).
 */
function recurring(memberId: string, weekday: string): Availability {
  return {
    id: `av-${memberId}-recurring`,
    member_id: memberId,
    kind: "recurring",
    pattern: { weekday },
    reason: null,
    reason_visibility: "planner",
  };
}

function range(memberId: string, from: string, to: string): Availability {
  return {
    id: `av-${memberId}-range`,
    member_id: memberId,
    kind: "range",
    pattern: { from, to },
    reason: "holiday",
    reason_visibility: "planner",
  };
}

function specific(memberId: string, dates: string[]): Availability {
  return {
    id: `av-${memberId}-specific`,
    member_id: memberId,
    kind: "specific",
    pattern: { dates },
    reason: null,
    reason_visibility: "planner",
  };
}

const ROSTER: Member[] = [
  {
    id: "anna",
    display_name: "Anna",
    joined_at: "2019-02-01", // veteran — wins join-date ties
    max_per_month: 5,
    skills: { [ROLE.vocals]: "lead", [ROLE.guitar]: "capable" },
    availability: [],
  },
  {
    id: "bjorn",
    display_name: "Bjørn",
    joined_at: "2021-08-15",
    max_per_month: 5,
    // Recurring Sunday block would knock him out of EVERY service, so instead
    // he blocks a single Sunday (a one-off, e.g. travel).
    skills: { [ROLE.vocals]: "lead", [ROLE.sound]: "lead" },
    availability: [specific("bjorn", ["2026-09-13"])],
  },
  {
    id: "carl-olsen",
    display_name: "Carl Olsen",
    joined_at: "2020-05-10",
    household_id: "olsen",
    max_per_month: 5,
    skills: { [ROLE.vocals]: "capable", [ROLE.guitar]: "lead" },
    availability: [],
  },
  {
    id: "dina-olsen",
    display_name: "Dina Olsen",
    joined_at: "2023-01-20",
    household_id: "olsen", // same household as Carl
    max_per_month: 5,
    skills: { [ROLE.vocals]: "lead", [ROLE.coffee]: "capable" },
    availability: [],
  },
  {
    id: "erik",
    display_name: "Erik",
    joined_at: "2022-03-03",
    max_per_month: 5,
    skills: { [ROLE.sound]: "lead", [ROLE.guitar]: "capable" },
    // Away the whole back half of the month (holiday range).
    availability: [range("erik", "2026-09-20", "2026-09-30")],
  },
  {
    id: "frida",
    display_name: "Frida",
    joined_at: "2024-09-01", // newest member
    max_per_month: 5,
    skills: { [ROLE.coffee]: "training", [ROLE.vocals]: "training" },
    availability: [],
  },
  {
    id: "gustav",
    display_name: "Gustav",
    joined_at: "2018-11-11", // most senior of all
    max_per_month: 5,
    skills: { [ROLE.sound]: "capable", [ROLE.coffee]: "lead" },
    // A standing Saturday block — must NOT affect any of the Sunday services.
    availability: [recurring("gustav", "saturday")],
  },
  {
    id: "hanne",
    display_name: "Hanne",
    joined_at: "2021-01-05",
    max_per_month: 5,
    skills: { [ROLE.coffee]: "trainer", [ROLE.vocals]: "capable" },
    // Never serves on the 27th (a recurring family commitment that lands then);
    // modelled as a one-off block for that date.
    availability: [specific("hanne", ["2026-09-27"])],
  },
];

const memberById = new Map(ROSTER.map((m) => [m.id, m]));

// Designated leads, for the key-person rule. Bjørn is the only declared lead
// for sound; if he's away, the rule should flag the un-covered services.
const KEY_PERSONS: KeyPerson[] = [{ member_id: "bjorn", role_id: ROLE.sound }];

// ── Scoring-input builder ────────────────────────────────────────────────────
//
// A neutral, mid-rotation history so the *skill match* dominates the ranking —
// that keeps the scenario's expectations easy to reason about while still
// flowing real data through every scoring component.
function scoringFor(
  member: Member,
  role: string,
  service: ServiceInfo,
): ScoringInputs {
  return {
    candidate: {
      member_id: member.id,
      skill_level: member.skills[role] ?? "training",
      accepted_recent_count: 4,
      days_since_last_assignment: 21,
      days_since_last_assignment_same_role: 21,
      target_serves_per_month: 2,
      availability: member.availability,
      consecutive_weeks_served: 1,
      has_frequent_partner_on_service: false,
      has_trainer_paired: false,
    },
    slot: {
      service_starts_at: service.starts_at,
      role_skill_required: ROLE_SKILL[role],
    },
  };
}

/** Build an auto-fill slot from every roster member who can serve the role. */
function slotFor(service: ServiceInfo, role: string, quantity: number): AutoFillSlot {
  const candidates = ROSTER.filter((m) => m.skills[role] !== undefined).map((m) => ({
    member_id: m.id,
    joined_at: m.joined_at,
    inputs: scoringFor(m, role, service),
  }));
  return { service_id: service.id, role_id: role, quantity, candidates };
}

// Each service needs: 2 vocalists, 1 guitar, 1 sound, 1 coffee.
function requirements(): RoleRequirement[] {
  const out: RoleRequirement[] = [];
  for (const s of SERVICES) {
    out.push({ service_id: s.id, role_id: ROLE.vocals, quantity: 2 });
    out.push({ service_id: s.id, role_id: ROLE.guitar, quantity: 1 });
    out.push({ service_id: s.id, role_id: ROLE.sound, quantity: 1 });
    out.push({ service_id: s.id, role_id: ROLE.coffee, quantity: 1 });
  }
  return out;
}

/** All slots for the month, chronological then by role priority. */
function allSlots(): AutoFillSlot[] {
  const slots: AutoFillSlot[] = [];
  for (const s of SERVICES) {
    slots.push(slotFor(s, ROLE.vocals, 2));
    slots.push(slotFor(s, ROLE.guitar, 1));
    slots.push(slotFor(s, ROLE.sound, 1));
    slots.push(slotFor(s, ROLE.coffee, 1));
  }
  return slots;
}

/** Turn auto-fill proposals into the denormalized placements the engines want. */
function toPlacements(
  assignments: { service_id: string; role_id: string; member_id: string }[],
): PlacedAssignment[] {
  return assignments.map((a) => {
    const member = memberById.get(a.member_id)!;
    return {
      member_id: a.member_id,
      service_id: a.service_id,
      role_id: a.role_id,
      skill_level: member.skills[a.role_id] ?? "training",
      role_skill_required: ROLE_SKILL[a.role_id],
    };
  });
}

function memberInfos(): MemberInfo[] {
  return ROSTER.map((m) => ({
    id: m.id,
    display_name: m.display_name,
    availability: m.availability,
    max_assignments_per_month: m.max_per_month,
    household_id: m.household_id ?? null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — auto-fill the whole month.
// ─────────────────────────────────────────────────────────────────────────────
describe("scenario · auto-fill the September rota", () => {
  const result = autoFill(allSlots());

  it("produces a deterministic, fully-documented proposal", () => {
    // The snapshot is the living spec for the scenario's expected output. If the
    // scoring/ranking ever changes, this is the one place to review the diff.
    const summary = result.assignments.map((a) => ({
      service: a.service_id,
      role: a.role_id,
      member: a.member_id,
      rank: a.rank,
    }));
    expect(summary).toMatchInlineSnapshot(`
      [
        {
          "member": "anna",
          "rank": 1,
          "role": "role-vocals",
          "service": "svc-sep06",
        },
        {
          "member": "bjorn",
          "rank": 2,
          "role": "role-vocals",
          "service": "svc-sep06",
        },
        {
          "member": "carl-olsen",
          "rank": 2,
          "role": "role-guitar",
          "service": "svc-sep06",
        },
        {
          "member": "gustav",
          "rank": 1,
          "role": "role-sound",
          "service": "svc-sep06",
        },
        {
          "member": "hanne",
          "rank": 2,
          "role": "role-coffee",
          "service": "svc-sep06",
        },
        {
          "member": "anna",
          "rank": 1,
          "role": "role-vocals",
          "service": "svc-sep13",
        },
        {
          "member": "dina-olsen",
          "rank": 2,
          "role": "role-vocals",
          "service": "svc-sep13",
        },
        {
          "member": "carl-olsen",
          "rank": 2,
          "role": "role-guitar",
          "service": "svc-sep13",
        },
        {
          "member": "gustav",
          "rank": 1,
          "role": "role-sound",
          "service": "svc-sep13",
        },
        {
          "member": "hanne",
          "rank": 2,
          "role": "role-coffee",
          "service": "svc-sep13",
        },
        {
          "member": "anna",
          "rank": 1,
          "role": "role-vocals",
          "service": "svc-sep20",
        },
        {
          "member": "bjorn",
          "rank": 2,
          "role": "role-vocals",
          "service": "svc-sep20",
        },
        {
          "member": "carl-olsen",
          "rank": 2,
          "role": "role-guitar",
          "service": "svc-sep20",
        },
        {
          "member": "gustav",
          "rank": 1,
          "role": "role-sound",
          "service": "svc-sep20",
        },
        {
          "member": "hanne",
          "rank": 2,
          "role": "role-coffee",
          "service": "svc-sep20",
        },
        {
          "member": "anna",
          "rank": 1,
          "role": "role-vocals",
          "service": "svc-sep27",
        },
        {
          "member": "bjorn",
          "rank": 2,
          "role": "role-vocals",
          "service": "svc-sep27",
        },
        {
          "member": "carl-olsen",
          "rank": 2,
          "role": "role-guitar",
          "service": "svc-sep27",
        },
        {
          "member": "gustav",
          "rank": 1,
          "role": "role-sound",
          "service": "svc-sep27",
        },
        {
          "member": "dina-olsen",
          "rank": 2,
          "role": "role-coffee",
          "service": "svc-sep27",
        },
      ]
    `);
  });

  it("fills every required slot across all four Sundays", () => {
    expect(result.unfilled).toEqual([]);
    // 4 services × (2 vocals + 1 guitar + 1 sound + 1 coffee) = 20 placements.
    expect(result.assignments).toHaveLength(20);
  });

  it("never double-books a member within one service", () => {
    const perService = new Map<string, string[]>();
    for (const a of result.assignments) {
      const list = perService.get(a.service_id) ?? [];
      list.push(a.member_id);
      perService.set(a.service_id, list);
    }
    for (const members of perService.values()) {
      expect(new Set(members).size).toBe(members.length);
    }
  });

  it("respects availability: Bjørn is skipped on the 13th (his one-off block)", () => {
    const sep13Vocals = result.assignments
      .filter((a) => a.service_id === "svc-sep13" && a.role_id === ROLE.vocals)
      .map((a) => a.member_id);
    expect(sep13Vocals).not.toContain("bjorn");
    // Dina steps in as the second vocalist that week.
    expect(sep13Vocals).toEqual(["anna", "dina-olsen"]);
  });

  it("respects a range block: Erik is never scheduled on the 20th or 27th", () => {
    const lateMonth = result.assignments
      .filter((a) => a.service_id === "svc-sep20" || a.service_id === "svc-sep27")
      .map((a) => a.member_id);
    expect(lateMonth).not.toContain("erik");
  });

  it("respects a specific block: Hanne is never scheduled on the 27th", () => {
    const sep27 = result.assignments
      .filter((a) => a.service_id === "svc-sep27")
      .map((a) => a.member_id);
    expect(sep27).not.toContain("hanne");
  });

  it("matches recurring blocks by weekday: Gustav's Saturday block leaves Sundays open", () => {
    // Gustav has a recurring SATURDAY block, but every service is on a Sunday,
    // so he is fully eligible — and indeed gets the sound slot every week.
    const gustavWeeks = result.assignments
      .filter((a) => a.member_id === "gustav")
      .map((a) => a.service_id);
    expect(gustavWeeks.sort()).toEqual(["svc-sep06", "svc-sep13", "svc-sep20", "svc-sep27"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — run conflict detection over the proposed schedule.
// ─────────────────────────────────────────────────────────────────────────────
describe("scenario · conflict detection over the proposed schedule", () => {
  const proposal = autoFill(allSlots());
  const placements = toPlacements(proposal.assignments);

  const ctx: ConflictContext = {
    services: SERVICES,
    assignments: placements,
    members: memberInfos(),
    requirements: requirements(),
    keyPersons: KEY_PERSONS,
    now: NOW,
  };

  const conflicts = detectConflicts(ctx);

  it("produces no HARD conflicts on a clean auto-fill", () => {
    // Auto-fill hard-gates on availability and never double-books, so the two
    // hard rules (double_booking, unavailable) must stay silent.
    const hard = conflicts.filter((c) => c.severity === "hard");
    expect(hard).toEqual([]);
  });

  it("does not flag a skill gap — every slot is filled at or above its level", () => {
    expect(conflicts.some((c) => c.rule === "skill_gap")).toBe(false);
  });

  it("flags the key-person gap when the only sound lead is away", () => {
    // Bjørn is the sole declared sound lead and is unavailable on the 13th, so
    // the key_person_unavailable rule fires for that service's sound slot.
    const kp = conflicts.filter((c) => c.rule === "key_person_unavailable");
    expect(kp).toHaveLength(1);
    expect(kp[0]).toMatchObject({
      severity: "soft",
      service_id: "svc-sep13",
      role_id: ROLE.sound,
    });
  });

  it("detects the family conflicts auto-fill leaves behind", () => {
    // This is the headline cross-engine finding: family conflict is a SOFT rule,
    // so auto-fill (which only hard-gates availability + double-booking) does not
    // avoid it. When the roster gets thin — Bjørn out on the 13th, Erik + Hanne
    // out on the 27th — auto-fill backfills with Dina while Carl is already
    // playing guitar that service, so both Olsens land on the same Sunday.
    // Conflict detection is what surfaces it for the planner to resolve.
    const family = conflicts.filter((c) => c.rule === "family_conflict");
    expect(family.every((c) => c.severity === "soft")).toBe(true);

    // One conflict per Olsen, per affected service (so the grid can mark each
    // cell). The collisions land on the two thin Sundays: the 13th and the 27th.
    const byService = new Map<string, string[]>();
    for (const c of family) {
      const list = byService.get(c.service_id!) ?? [];
      list.push(c.member_id!);
      byService.set(c.service_id!, list);
    }
    const affected = [...byService.keys()].sort();
    expect(affected).toEqual(["svc-sep13", "svc-sep27"]);
    for (const svc of affected) {
      expect(byService.get(svc)!.sort()).toEqual(["carl-olsen", "dina-olsen"]);
    }

    // The two roomy Sundays (the 6th + 20th) keep the Olsens apart.
    expect(byService.has("svc-sep06")).toBe(false);
    expect(byService.has("svc-sep20")).toBe(false);
  });

  it("flags unfilled required slots near the deadline", () => {
    // Drop the coffee role from the very first service (within the warn window)
    // and confirm rule 7 reports the shortfall.
    const missingCoffee = placements.filter(
      (p) => !(p.service_id === "svc-sep06" && p.role_id === ROLE.coffee),
    );
    const flagged = detectConflicts({ ...ctx, assignments: missingCoffee });
    const unfilled = flagged.filter(
      (c) => c.rule === "unfilled_near_deadline" && c.service_id === "svc-sep06",
    );
    expect(unfilled).toHaveLength(1);
    expect(unfilled[0].role_id).toBe(ROLE.coffee);
  });

  it("flags burnout / consecutive Sundays if one member serves every week", () => {
    // Force Gustav onto sound all four consecutive Sundays.
    const allFour: PlacedAssignment[] = SERVICES.map((s) => ({
      member_id: "gustav",
      service_id: s.id,
      role_id: ROLE.sound,
      skill_level: "capable",
      role_skill_required: ROLE_SKILL[ROLE.sound],
    }));
    const flagged = detectConflicts({ ...ctx, assignments: allFour });
    const consecutive = flagged.filter(
      (c) => c.rule === "consecutive_sundays" && c.member_id === "gustav",
    );
    expect(consecutive).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — a volunteer drops out; rank replacements with the swap finder.
// ─────────────────────────────────────────────────────────────────────────────
describe("scenario · swap-finding when a volunteer drops out", () => {
  const proposal = autoFill(allSlots());
  const placements = toPlacements(proposal.assignments);

  // Anna can no longer sing vocals on the 6th. Build the schedule snapshot with
  // her placement removed (the engine judges replacements against the vacated
  // slot, per its contract).
  const sep06 = SERVICES[0];
  const vacated = placements.filter(
    (p) => !(p.member_id === "anna" && p.service_id === sep06.id && p.role_id === ROLE.vocals),
  );

  // Everyone who can sing, isn't already on this service, and isn't Anna herself.
  const alreadyOnSvc = new Set(
    vacated.filter((p) => p.service_id === sep06.id).map((p) => p.member_id),
  );
  const replacementPool: ReplacementCandidate[] = ROSTER.filter(
    (m) => m.skills[ROLE.vocals] !== undefined && m.id !== "anna",
  ).map((m) => ({
    member_id: m.id,
    placement: {
      member_id: m.id,
      service_id: sep06.id,
      role_id: ROLE.vocals,
      skill_level: m.skills[ROLE.vocals]!,
      role_skill_required: ROLE_SKILL[ROLE.vocals],
    },
    scoring: scoringFor(m, ROLE.vocals, sep06),
  }));

  const ctx: ConflictContext = {
    services: SERVICES,
    assignments: vacated,
    members: memberInfos(),
    requirements: requirements(),
    keyPersons: KEY_PERSONS,
    now: NOW,
  };

  const ranked = eligibleReplacements({
    ctx,
    candidates: replacementPool,
    excludeMemberIds: ["anna", ...alreadyOnSvc],
  });

  it("returns a non-empty, score-descending replacement ranking", () => {
    expect(ranked.length).toBeGreaterThan(0);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  it("never offers someone already serving on that service (no double-book)", () => {
    for (const r of ranked) {
      expect(alreadyOnSvc.has(r.member_id)).toBe(false);
    }
    // Bjørn already holds the 2nd vocals seat on the 6th, so he must be excluded.
    expect(ranked.map((r) => r.member_id)).not.toContain("bjorn");
  });

  it("ranks lead-skilled vocalists above training-only ones", () => {
    // Dina (lead) should outrank Frida (training) for the lead-level vocals slot.
    const dina = ranked.findIndex((r) => r.member_id === "dina-olsen");
    const frida = ranked.findIndex((r) => r.member_id === "frida");
    expect(dina).toBeGreaterThanOrEqual(0);
    expect(frida).toBeGreaterThanOrEqual(0);
    expect(dina).toBeLessThan(frida);
  });

  it("drops candidates who are unavailable on the slot's date (hard gate)", () => {
    // Make the replacement fall on the 13th instead — Bjørn is blocked then, so
    // even though he'd otherwise be a strong lead-level fit he must not appear.
    const sep13 = SERVICES[1];
    const sep13Pool: ReplacementCandidate[] = ROSTER.filter(
      (m) => m.skills[ROLE.vocals] !== undefined,
    ).map((m) => ({
      member_id: m.id,
      placement: {
        member_id: m.id,
        service_id: sep13.id,
        role_id: ROLE.vocals,
        skill_level: m.skills[ROLE.vocals]!,
        role_skill_required: ROLE_SKILL[ROLE.vocals],
      },
      scoring: scoringFor(m, ROLE.vocals, sep13),
    }));
    const sep13Ranked = eligibleReplacements({
      ctx: { ...ctx, assignments: [] },
      candidates: sep13Pool,
    });
    expect(sep13Ranked.map((r) => r.member_id)).not.toContain("bjorn");
  });

  it("agrees with the standalone scorer on the top pick (engines compose)", () => {
    // Cross-check: the swap finder's #1 should be the member whose raw
    // `scoreCandidate` is highest among the eligible pool — proving swap.ts is a
    // thin composition of the same scoring engine auto-fill uses.
    const eligibleScores = replacementPool
      .filter((c) => c.member_id !== "bjorn") // already on svc, excluded
      .map((c) => ({ id: c.member_id, score: scoreCandidate(c.scoring)?.total ?? -1 }))
      .sort((a, b) => b.score - a.score);
    expect(ranked[0].member_id).toBe(eligibleScores[0].id);
  });
});
