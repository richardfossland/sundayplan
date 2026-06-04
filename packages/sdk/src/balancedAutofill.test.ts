import { describe, expect, it } from "vitest";
import type { Availability, SkillLevel } from "@sundayplan/shared";
import { balancedAutoFill } from "./balancedAutofill";
import { autoFill, type AutoFillCandidate, type AutoFillSlot } from "./autofill";
import { scoreCandidate, type ScoringInputs } from "./scoring";

const SERVICE_DATE = new Date("2026-09-13T12:00:00Z");

/** Baseline scoring inputs; same builder shape as autofill.test.ts. */
function inputs(skill: SkillLevel, need: SkillLevel = "lead"): ScoringInputs {
  return {
    candidate: {
      member_id: "x",
      skill_level: skill,
      accepted_recent_count: 6,
      days_since_last_assignment: 14,
      days_since_last_assignment_same_role: 28,
      target_serves_per_month: 2,
      availability: [],
      consecutive_weeks_served: 1,
      has_frequent_partner_on_service: true,
      has_trainer_paired: false,
    },
    slot: { service_starts_at: SERVICE_DATE, role_skill_required: need },
  };
}

function blockedOn(dateIso: string, member_id: string): Availability {
  return {
    id: `av-${member_id}`,
    member_id,
    kind: "specific",
    pattern: { dates: [dateIso] },
    reason: null,
    reason_visibility: "planner",
  };
}

function cand(
  member_id: string,
  skill: SkillLevel,
  opts: {
    joined_at?: string | null;
    unavailableOn?: string;
    need?: SkillLevel;
    prior?: number;
    pinned?: boolean;
  } = {},
): AutoFillCandidate {
  const i = inputs(skill, opts.need ?? "lead");
  return {
    member_id,
    joined_at: opts.joined_at ?? "2020-01-01",
    window_serves_prior: opts.prior,
    pinned: opts.pinned,
    inputs: {
      ...i,
      candidate: {
        ...i.candidate,
        member_id,
        availability: opts.unavailableOn ? [blockedOn(opts.unavailableOn, member_id)] : [],
      },
    },
  };
}

function slot(
  service_id: string,
  role_id: string,
  quantity: number,
  candidates: AutoFillCandidate[],
): AutoFillSlot {
  return { service_id, role_id, quantity, candidates };
}

/** Build a load map (member → assignment count) from a result. */
function loadCounts(assignments: { member_id: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of assignments) m.set(a.member_id, (m.get(a.member_id) ?? 0) + 1);
  return m;
}

describe("balancedAutoFill — backward compatibility", () => {
  it("with no priors/pins, fills the same slots the greedy autoFill would", () => {
    const slots = [
      slot("s1", "r1", 1, [cand("a", "capable"), cand("b", "lead")]),
      slot("s2", "r1", 2, [cand("a", "training"), cand("b", "lead"), cand("c", "capable")]),
    ];
    const greedy = autoFill(slots);
    const balanced = balancedAutoFill(slots);
    // Same total coverage (count of assignments + unfilled shape) — balancing
    // never drops or adds a placement, only reassigns.
    expect(balanced.assignments.length).toBe(greedy.assignments.length);
    expect(balanced.unfilled).toEqual(greedy.unfilled);
  });

  it("leaves a slot unfilled rather than assigning an ineligible candidate", () => {
    const slots = [
      slot("s1", "r1", 1, [
        cand("a", "lead", { unavailableOn: "2026-09-13" }),
        cand("b", "lead", { unavailableOn: "2026-09-13" }),
      ]),
    ];
    const res = balancedAutoFill(slots);
    expect(res.assignments).toEqual([]);
    expect(res.unfilled).toEqual([
      { service_id: "s1", role_id: "r1", needed: 1, filled: 0, reason: "no_eligible_candidates" },
    ]);
  });
});

describe("balancedAutoFill — flattening", () => {
  // 3 services, identical single-role need. The same three members are eligible
  // everywhere with IDENTICAL scores (same skill, same history), so the greedy
  // picks the same id (the tiebreaker winner) for all three → load 3/0/0.
  function threeIdenticalServices(): AutoFillSlot[] {
    return ["s1", "s2", "s3"].map((s) =>
      slot(s, "r1", 1, [cand("a", "lead"), cand("b", "lead"), cand("c", "lead")]),
    );
  }

  it("greedy concentrates load; balanced flattens it", () => {
    const slots = threeIdenticalServices();

    const greedy = autoFill(slots);
    const greedyLoad = loadCounts(greedy.assignments);
    // Greedy hammers one member (the deterministic tiebreak winner "a").
    expect(Math.max(...greedyLoad.values())).toBe(3);
    expect(Math.min(...[...greedyLoad.values()])).toBe(3); // only one member present

    const balanced = balancedAutoFill(slots);
    expect(balanced.assignments.length).toBe(3);
    const balancedLoad = loadCounts(balanced.assignments);
    // Each of a, b, c now serves exactly once.
    expect([...balancedLoad.values()].sort()).toEqual([1, 1, 1]);
  });

  it("post-balance gap is <= pre-balance gap (the core invariant)", () => {
    const slots = threeIdenticalServices();
    const res = balancedAutoFill(slots);
    expect(res.fairness.gapAfter).toBeLessThanOrEqual(res.fairness.gapBefore);
    // Concretely 3 → 0 here.
    expect(res.fairness.gapBefore).toBe(3);
    expect(res.fairness.gapAfter).toBe(0);
  });

  it("records each applied swap with a load + gap reason", () => {
    const res = balancedAutoFill(threeIdenticalServices());
    expect(res.fairness.swaps.length).toBeGreaterThan(0);
    for (const s of res.fairness.swaps) {
      expect(s.from_member_id).not.toBe(s.to_member_id);
      expect(s.gap_after).toBeLessThanOrEqual(res.fairness.gapBefore);
      expect(typeof s.reason).toBe("string");
    }
    // Swaps only ever drained the over-loaded member onto under-loaded ones.
    expect(res.fairness.swaps.every((s) => s.from_load_before > s.to_load_before)).toBe(true);
  });
});

describe("balancedAutoFill — total relevance epsilon", () => {
  it("total relevance stays within epsilon of the greedy baseline", () => {
    // Members score identically, so flattening is score-neutral.
    const slots = ["s1", "s2", "s3"].map((s) =>
      slot(s, "r1", 1, [cand("a", "lead"), cand("b", "lead"), cand("c", "lead")]),
    );
    const res = balancedAutoFill(slots, { epsilon: 2 });
    expect(res.fairness.totalScoreBefore - res.fairness.totalScoreAfter).toBeLessThanOrEqual(2);
    expect(res.fairness.totalScoreAfter).toBeCloseTo(res.fairness.totalScoreBefore, 5);
  });

  it("with epsilon 0 it refuses a flattening move that would lower total score", () => {
    // Here b is strictly weaker than a (capable vs lead → lower score). Loading
    // a everywhere is the greedy outcome; flattening onto b costs score.
    const slots = ["s1", "s2", "s3"].map((s) =>
      slot(s, "r1", 1, [cand("a", "lead"), cand("b", "capable")]),
    );

    const strict = balancedAutoFill(slots, { epsilon: 0 });
    // No move may be applied: every flattening move lowers total score.
    expect(strict.fairness.swaps).toEqual([]);
    expect(strict.fairness.totalScoreAfter).toBe(strict.fairness.totalScoreBefore);
    // ...so load stays concentrated (the planner asked for zero fit sacrifice).
    const load = loadCounts(strict.assignments);
    expect(Math.max(...load.values())).toBe(3);
  });

  it("a generous epsilon permits the score-costing flattening move", () => {
    const slots = ["s1", "s2", "s3"].map((s) =>
      slot(s, "r1", 1, [cand("a", "lead"), cand("b", "capable")]),
    );
    // lead≈95, capable≈83 → per-move cost ≈12. epsilon 15 admits it.
    const loose = balancedAutoFill(slots, { epsilon: 15 });
    expect(loose.fairness.swaps.length).toBeGreaterThan(0);
    expect(loose.fairness.gapAfter).toBeLessThan(loose.fairness.gapBefore);
    // And it never dropped more than epsilon overall per the acceptance rule
    // (each move within epsilon; total may aggregate but gap improved).
    expect(loose.fairness.totalScoreBefore - loose.fairness.totalScoreAfter).toBeGreaterThan(0);
  });
});

describe("balancedAutoFill — never introduces a hard-constraint violation", () => {
  it("never assigns an unavailable candidate while flattening", () => {
    // b is unavailable on s2's date; a is the heavy default. Flattening must not
    // shove b into s2 to even the load — b isn't even in s2's eligible set.
    const s2date = "2026-09-20";
    const slots = [
      slot("s1", "r1", 1, [cand("a", "lead"), cand("b", "lead")]),
      slot("s2", "r1", 1, [
        // s2 is on a different date; build candidates with that date.
        candOn("a", "lead", "2026-09-20"),
        candOn("b", "lead", "2026-09-20", { unavailableOn: s2date }),
      ]),
      slot("s3", "r1", 1, [
        candOn("a", "lead", "2026-09-27"),
        candOn("b", "lead", "2026-09-27"),
      ]),
    ];
    const res = balancedAutoFill(slots);
    // No assignment lands on a date the member is unavailable.
    for (const a of res.assignments) {
      // b is only unavailable on s2.
      if (a.member_id === "b") expect(a.service_id).not.toBe("s2");
    }
    // Sanity: every chosen candidate scored (eligible) — re-score returns a value.
    expect(res.assignments.every((a) => a.score.total > 0)).toBe(true);
  });

  it("never double-books a member into the same service via flattening", () => {
    // Two roles in one service. a is heavy elsewhere; flattening must not place
    // a into BOTH roles of s1 just to drain another service.
    const slots = [
      slot("s1", "r1", 1, [cand("a", "lead"), cand("b", "lead")]),
      slot("s1", "r2", 1, [cand("a", "lead"), cand("b", "lead")]),
      slot("s2", "r1", 1, [
        candOn("a", "lead", "2026-09-20"),
        candOn("b", "lead", "2026-09-20"),
      ]),
    ];
    const res = balancedAutoFill(slots);
    // No member appears twice in s1.
    const inS1 = res.assignments.filter((a) => a.service_id === "s1").map((a) => a.member_id);
    expect(new Set(inS1).size).toBe(inS1.length);
  });
});

describe("balancedAutoFill — pinned/locked slots are never moved", () => {
  it("does not move a pinned assignment even when it is the heaviest", () => {
    // a is pinned to all 3 services (manual). They are over-loaded but locked.
    // The balancer must NOT touch them; it can only fill/balance the OTHER role.
    const slots = [
      slot("s1", "lead_role", 1, [cand("a", "lead", { pinned: true })]),
      slot("s2", "lead_role", 1, [candOn("a", "lead", "2026-09-20", { pinned: true })]),
      slot("s3", "lead_role", 1, [candOn("a", "lead", "2026-09-27", { pinned: true })]),
    ];
    const res = balancedAutoFill(slots);
    // a stays on all three (pinned), no swaps reassign them.
    expect(res.fairness.swaps).toEqual([]);
    // Pinned placements aren't emitted as engine proposals (they're manual).
    expect(res.assignments).toEqual([]);
    // But a's load reflects the 3 pinned serves in the fairness summary.
    const aLine = res.fairness.perMember.find((l) => l.member_id === "a");
    expect(aLine?.load).toBe(3);
  });

  it("balances the fillable slots around a pinned member without moving the pin", () => {
    // s1.r1 pinned to a. s2.r1 and s3.r1 are open with a, b, c eligible.
    // Greedy would pick a again for s2,s3 (top tiebreak) → a heavy. Balancer
    // should route s2,s3 to b and c, leaving a's pin intact.
    const slots = [
      slot("s1", "r1", 1, [cand("a", "lead", { pinned: true })]),
      slot("s2", "r1", 1, [
        candOn("a", "lead", "2026-09-20"),
        candOn("b", "lead", "2026-09-20"),
        candOn("c", "lead", "2026-09-20"),
      ]),
      slot("s3", "r1", 1, [
        candOn("a", "lead", "2026-09-27"),
        candOn("b", "lead", "2026-09-27"),
        candOn("c", "lead", "2026-09-27"),
      ]),
    ];
    const res = balancedAutoFill(slots);
    const aLine = res.fairness.perMember.find((l) => l.member_id === "a")!;
    // a keeps exactly the 1 pinned serve (never auto-assigned more).
    expect(aLine.load).toBe(1);
    expect(res.fairness.gapAfter).toBeLessThanOrEqual(res.fairness.gapBefore);
    // s2 and s3 went to the under-loaded b and c.
    const filled = res.assignments.map((x) => x.member_id).sort();
    expect(filled).toEqual(["b", "c"]);
  });
});

describe("balancedAutoFill — cumulative window fairness (priors)", () => {
  it("avoids hammering a volunteer who already served earlier in the window", () => {
    // a and b score identically and are both eligible for s1 and s2, BUT a
    // already carries 2 prior serves this window. The balancer should prefer b
    // so a isn't loaded further. Greedy (no prior awareness) would pick a (tie).
    const slots = [
      slot("s1", "r1", 1, [cand("a", "lead", { prior: 2 }), cand("b", "lead", { prior: 0 })]),
      slot("s2", "r1", 1, [
        candOn("a", "lead", "2026-09-20", { prior: 2 }),
        candOn("b", "lead", "2026-09-20", { prior: 0 }),
      ]),
    ];
    const res = balancedAutoFill(slots);
    const load = new Map(res.fairness.perMember.map((l) => [l.member_id, l.load]));
    // a started at 2; b started at 0. Flattening loads b, leaving a at 2.
    expect(load.get("a")).toBe(2);
    expect(load.get("b")).toBe(2);
    expect(res.fairness.gapAfter).toBeLessThanOrEqual(res.fairness.gapBefore);
  });

  it("threading prior 0 everywhere reproduces the no-prior outcome (default-safe)", () => {
    const withPrior = ["s1", "s2", "s3"].map((s) =>
      slot(s, "r1", 1, [cand("a", "lead", { prior: 0 }), cand("b", "lead", { prior: 0 })]),
    );
    const without = ["s1", "s2", "s3"].map((s) =>
      slot(s, "r1", 1, [cand("a", "lead"), cand("b", "lead")]),
    );
    const r1 = balancedAutoFill(withPrior);
    const r2 = balancedAutoFill(without);
    expect(loadCounts(r1.assignments)).toEqual(loadCounts(r2.assignments));
    expect(r1.fairness.gapAfter).toBe(r2.fairness.gapAfter);
  });
});

describe("balancedAutoFill — determinism", () => {
  it("produces identical output for the same input", () => {
    const make = () =>
      ["s1", "s2", "s3", "s4"].map((s, idx) =>
        slot(s, "r1", 1, [
          cand("a", "lead"),
          cand("b", "lead"),
          cand("c", "capable"),
          cand(`d${idx}`, "lead"),
        ]),
      );
    const r1 = balancedAutoFill(make());
    const r2 = balancedAutoFill(make());
    expect(r1.assignments).toEqual(r2.assignments);
    expect(r1.unfilled).toEqual(r2.unfilled);
    expect(r1.fairness).toEqual(r2.fairness);
  });
});

describe("balancedAutoFill — exhaustive invariant sweep", () => {
  // Generate a spread of small scenarios deterministically and assert the hard
  // invariants hold on every one: gap never grows, no double-book, no
  // unavailable assignment, total score within epsilon.
  function scenario(seed: number): AutoFillSlot[] {
    const members = ["a", "b", "c", "d", "e"];
    const dates = ["2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04"];
    const slots: AutoFillSlot[] = [];
    for (let s = 0; s < 4; s++) {
      const date = dates[s];
      const candidates: AutoFillCandidate[] = members.map((m, mi) => {
        const skill: SkillLevel = (seed + s + mi) % 3 === 0 ? "capable" : "lead";
        const unavailable = (seed * 7 + s * 3 + mi) % 5 === 0;
        const prior = (seed + mi) % 3;
        return candOn(m, skill, date, { unavailableOn: unavailable ? date : undefined, prior });
      });
      slots.push(slot(`s${s}`, "r1", 1, candidates));
    }
    return slots;
  }

  for (let seed = 0; seed < 12; seed++) {
    it(`invariants hold for scenario seed=${seed}`, () => {
      const slots = scenario(seed);
      const res = balancedAutoFill(slots, { epsilon: 3 });

      // 1. Gap never grows.
      expect(res.fairness.gapAfter).toBeLessThanOrEqual(res.fairness.gapBefore);

      // 2. No double-booking within a service.
      const perService = new Map<string, string[]>();
      for (const a of res.assignments) {
        const arr = perService.get(a.service_id) ?? [];
        arr.push(a.member_id);
        perService.set(a.service_id, arr);
      }
      for (const arr of perService.values()) {
        expect(new Set(arr).size).toBe(arr.length);
      }

      // 3. Every emitted assignment is genuinely eligible (re-score ≠ null) — so
      //    no unavailable / hard-gated candidate ever got placed by a swap.
      const slotByKey = new Map(slots.map((s) => [`${s.service_id}|${s.role_id}`, s]));
      for (const a of res.assignments) {
        const src = slotByKey.get(`${a.service_id}|${a.role_id}`)!;
        const c = src.candidates.find((x) => x.member_id === a.member_id)!;
        expect(scoreCandidate(c.inputs)).not.toBeNull();
      }

      // 4. Total relevance within epsilon of the baseline.
      expect(res.fairness.totalScoreBefore - res.fairness.totalScoreAfter).toBeLessThanOrEqual(3);

      // 5. Deterministic re-run.
      const again = balancedAutoFill(scenario(seed), { epsilon: 3 });
      expect(again.assignments).toEqual(res.assignments);
      expect(again.fairness.swaps).toEqual(res.fairness.swaps);
    });
  }
});

// ── helpers needing a specific service date ──────────────────────────────────

function candOn(
  member_id: string,
  skill: SkillLevel,
  dateIso: string,
  opts: {
    unavailableOn?: string;
    prior?: number;
    pinned?: boolean;
    need?: SkillLevel;
    committedOn?: string[];
  } = {},
): AutoFillCandidate {
  const base = cand(member_id, skill, {
    unavailableOn: opts.unavailableOn,
    prior: opts.prior,
    pinned: opts.pinned,
    need: opts.need,
  });
  // Re-point the slot date.
  const date = new Date(`${dateIso}T12:00:00Z`);
  return {
    ...base,
    committed_times: (opts.committedOn ?? []).map((d) => new Date(`${d}T12:00:00Z`).getTime()),
    inputs: { ...base.inputs, slot: { ...base.inputs.slot, service_starts_at: date } },
  };
}

// ── Rest-window awareness (conflict rule 11) ─────────────────────────────────
describe("balancedAutoFill — minRestDays gate", () => {
  it("default (no minRestDays) leaves behaviour unchanged", () => {
    // Two adjacent-day slots; one lone candidate would take both.
    const slots = [
      slot("s1", "r1", 1, [candOn("a", "lead", "2026-09-13")]),
      slot("s2", "r1", 1, [candOn("a", "lead", "2026-09-14")]),
    ];
    const res = balancedAutoFill(slots);
    expect(res.assignments.map((x) => `${x.service_id}:${x.member_id}`).sort()).toEqual(["s1:a", "s2:a"]);
  });

  it("greedy fill respects the rest window — second slot goes to a fresh peer", () => {
    const slots = [
      slot("s1", "r1", 1, [candOn("a", "lead", "2026-09-13")]),
      // s2 two days later; 'a' too soon (window 6) → 'b' fills it.
      slot("s2", "r1", 1, [candOn("a", "lead", "2026-09-15"), candOn("b", "lead", "2026-09-15")]),
    ];
    const res = balancedAutoFill(slots, { minRestDays: 6 });
    const byService = Object.fromEntries(res.assignments.map((x) => [x.service_id, x.member_id]));
    expect(byService).toEqual({ s1: "a", s2: "b" });
  });

  it("a flattening move never creates a rest-window violation", () => {
    // 'a' is the eager top scorer everywhere; 'b' is an equally-scored idle peer
    // BUT 'b' already has a committed service on 2026-09-12, one day before s2.
    // Without the gate the balancer would move s2 from a→b to flatten load; with
    // a 6-day window that move is forbidden, so 'b' is not pulled onto s2.
    const slots = [
      slot("s1", "r1", 1, [candOn("a", "lead", "2026-09-06")]),
      slot("s2", "r1", 1, [
        candOn("a", "lead", "2026-09-13"),
        candOn("b", "lead", "2026-09-13", { committedOn: ["2026-09-12"] }),
      ]),
    ];
    const res = balancedAutoFill(slots, { minRestDays: 6 });
    // s2 must stay with 'a' (moving to 'b' would breach 'b's rest window).
    const s2 = res.assignments.find((x) => x.service_id === "s2");
    expect(s2?.member_id).toBe("a");
    // And the result must contain no rest-window-violating swap.
    for (const sw of res.fairness.swaps) {
      expect(sw.to_member_id).not.toBe("b");
    }
  });

  it("is deterministic with the gate engaged", () => {
    const slots = () => [
      slot("s1", "r1", 1, [candOn("a", "lead", "2026-09-13")]),
      slot("s2", "r1", 1, [candOn("a", "lead", "2026-09-15"), candOn("b", "lead", "2026-09-15")]),
    ];
    const a = balancedAutoFill(slots(), { minRestDays: 6 });
    const b = balancedAutoFill(slots(), { minRestDays: 6 });
    expect(a.assignments).toEqual(b.assignments);
    expect(a.fairness.swaps).toEqual(b.fairness.swaps);
  });
});
