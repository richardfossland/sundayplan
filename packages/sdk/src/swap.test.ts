import { describe, expect, it } from "vitest";
import type { Availability, SkillLevel } from "@sundayplan/shared";
import { eligibleReplacements, type ReplacementCandidate } from "./swap";
import type { ConflictContext, PlacedAssignment } from "./conflicts";
import type { ScoringInputs } from "./scoring";

// 2026-01-04 is a Sunday; "now" sits a week earlier so the slot is in the future.
const SUNDAY = new Date("2026-01-04T11:00:00Z");
const NOW = new Date("2025-12-28T00:00:00Z");

function specific(memberId: string, dates: string[]): Availability {
  return { id: `av-${memberId}`, member_id: memberId, kind: "specific", pattern: { dates }, reason: null, reason_visibility: "planner" };
}

function scoring(memberId: string, opts: { skill?: SkillLevel; availability?: Availability[] } = {}): ScoringInputs {
  return {
    candidate: {
      member_id: memberId,
      skill_level: opts.skill ?? "capable",
      accepted_recent_count: 0,
      days_since_last_assignment: null,
      days_since_last_assignment_same_role: null,
      target_serves_per_month: 2,
      availability: opts.availability ?? [],
      consecutive_weeks_served: 0,
      has_frequent_partner_on_service: false,
      has_trainer_paired: false,
    },
    slot: { service_starts_at: SUNDAY, role_skill_required: "capable" },
  };
}

function placement(memberId: string, skill: SkillLevel = "capable"): PlacedAssignment {
  return { member_id: memberId, service_id: "svc1", role_id: "sound", skill_level: skill, role_skill_required: "capable" };
}

function candidate(memberId: string, opts: { skill?: SkillLevel; availability?: Availability[] } = {}): ReplacementCandidate {
  return { member_id: memberId, placement: placement(memberId, opts.skill), scoring: scoring(memberId, opts) };
}

function ctx(extra: Partial<ConflictContext> = {}): ConflictContext {
  return {
    services: [{ id: "svc1", starts_at: SUNDAY }],
    members: [
      { id: "ava", availability: [], max_assignments_per_month: 4 },
      { id: "ben", availability: [], max_assignments_per_month: 4 },
      { id: "cara", availability: [], max_assignments_per_month: 4 },
    ],
    assignments: [],
    now: NOW,
    ...extra,
  };
}

describe("eligibleReplacements", () => {
  it("returns every available candidate, sorted best-first by score", () => {
    const ranked = eligibleReplacements({
      ctx: ctx(),
      candidates: [candidate("ava", { skill: "capable" }), candidate("ben", { skill: "trainer" })],
    });
    expect(ranked).toHaveLength(2);
    expect(new Set(ranked.map((r) => r.member_id))).toEqual(new Set(["ava", "ben"]));
    // Whatever the engine decides, the list is ordered by descending score.
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
  });

  it("drops a candidate who is unavailable that day (hard gate in scoring)", () => {
    const ranked = eligibleReplacements({
      ctx: ctx(),
      candidates: [
        candidate("ava"),
        candidate("ben", { availability: [specific("ben", ["2026-01-04"])] }),
      ],
    });
    expect(ranked.map((r) => r.member_id)).toEqual(["ava"]);
  });

  it("drops a candidate who would create a hard conflict (double booking)", () => {
    // Ben is already serving on svc1 in another role — adding him again is a
    // double booking, so he must not be offered as a replacement.
    const ranked = eligibleReplacements({
      ctx: ctx({
        assignments: [
          { member_id: "ben", service_id: "svc1", role_id: "vocals", skill_level: "capable", role_skill_required: "capable" },
        ],
      }),
      candidates: [candidate("ava"), candidate("ben")],
    });
    expect(ranked.map((r) => r.member_id)).toEqual(["ava"]);
  });

  it("honours excludeMemberIds (e.g. the declining volunteer)", () => {
    const ranked = eligibleReplacements({
      ctx: ctx(),
      candidates: [candidate("ava"), candidate("ben")],
      excludeMemberIds: ["ava"],
    });
    expect(ranked.map((r) => r.member_id)).toEqual(["ben"]);
  });

  it("returns an empty list when no one qualifies", () => {
    const ranked = eligibleReplacements({
      ctx: ctx(),
      candidates: [candidate("ava", { availability: [specific("ava", ["2026-01-04"])] })],
    });
    expect(ranked).toEqual([]);
  });
});
