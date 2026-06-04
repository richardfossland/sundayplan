import { describe, expect, it } from "vitest";
import type { Availability, SkillLevel } from "@sundayplan/shared";
import {
  eligibleReplacements,
  isSwapResolvable,
  decideAssignCandidate,
  decideCancelSwap,
  type ReplacementCandidate,
} from "./swap";
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

describe("isSwapResolvable", () => {
  it("is true only for open swaps", () => {
    expect(isSwapResolvable("open")).toBe(true);
    expect(isSwapResolvable("claimed")).toBe(false);
    expect(isSwapResolvable("resolved")).toBe(false);
    expect(isSwapResolvable("cancelled")).toBe(false);
    expect(isSwapResolvable("garbage")).toBe(false);
  });
});

describe("decideAssignCandidate", () => {
  const base = {
    status: "open" as const,
    candidateId: "ben",
    requesterId: "ava",
    eligibleMemberIds: ["ben", "cara"] as const,
  };

  it("accepts an eligible candidate on an open swap", () => {
    expect(decideAssignCandidate(base)).toEqual({ ok: true, memberId: "ben" });
  });

  it("rejects when the swap is no longer open (concurrency guard)", () => {
    expect(decideAssignCandidate({ ...base, status: "resolved" })).toEqual({ ok: false, error: "not_open" });
    expect(decideAssignCandidate({ ...base, status: "cancelled" })).toEqual({ ok: false, error: "not_open" });
    expect(decideAssignCandidate({ ...base, status: "claimed" })).toEqual({ ok: false, error: "not_open" });
  });

  it("rejects a candidate who isn't in the ranked shortlist", () => {
    expect(decideAssignCandidate({ ...base, candidateId: "zoe" })).toEqual({
      ok: false,
      error: "candidate_not_eligible",
    });
  });

  it("refuses to reassign the slot back to the requester", () => {
    expect(
      decideAssignCandidate({ ...base, candidateId: "ava", eligibleMemberIds: ["ava", "ben"] }),
    ).toEqual({ ok: false, error: "candidate_is_requester" });
  });

  it("checks status before eligibility (a closed swap is closed regardless of pick)", () => {
    expect(decideAssignCandidate({ ...base, status: "resolved", candidateId: "zoe" })).toEqual({
      ok: false,
      error: "not_open",
    });
  });
});

describe("decideCancelSwap", () => {
  it("allows cancelling an open swap", () => {
    expect(decideCancelSwap("open")).toEqual({ ok: true });
  });

  it("refuses to cancel a swap that's already closed", () => {
    expect(decideCancelSwap("resolved")).toEqual({ ok: false, error: "not_open" });
    expect(decideCancelSwap("cancelled")).toEqual({ ok: false, error: "not_open" });
    expect(decideCancelSwap("claimed")).toEqual({ ok: false, error: "not_open" });
  });
});
