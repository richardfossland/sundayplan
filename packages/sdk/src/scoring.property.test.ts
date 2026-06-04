/**
 * Property / invariant fuzz over the pure scoring + comms + bundle cores.
 *
 * Deterministic: a fixed-seed mulberry32 PRNG drives all randomness, so a
 * failure reproduces byte-for-byte. Iterations are capped low (enough to hit
 * edge cases, cheap to run). These pin ROUND-TRIP / BOUNDS / MONOTONICITY
 * invariants that the existing fixture tests assert only at hand-picked points.
 */

import { describe, expect, it } from "vitest";
import type { SkillLevel } from "@sundayplan/shared";
import {
  consecutiveWeeksServed,
  scoreCandidate,
  type ScoringInputs,
} from "./scoring";
import { daysBetween } from "./comms";
import {
  readServicePlanBundle,
  serializeServicePlanBundle,
  writeServicePlanBundle,
} from "./serviceplan-bundle";
import type { ServicePlan } from "./serviceplan";

// ── deterministic PRNG ────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ITER = 400;
const SKILLS: SkillLevel[] = ["training", "capable", "lead", "trainer"];

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function int(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function randInput(rng: () => number, over: Partial<ScoringInputs["candidate"]> = {}): ScoringInputs {
  const nullable = (v: number) => (rng() < 0.15 ? null : v);
  return {
    candidate: {
      member_id: "m",
      skill_level: pick(rng, SKILLS),
      accepted_recent_count: int(rng, -5, 60),
      days_since_last_assignment: nullable(int(rng, -10, 200)),
      days_since_last_assignment_same_role: nullable(int(rng, -10, 200)),
      target_serves_per_month: int(rng, 0, 8),
      availability: [],
      consecutive_weeks_served: int(rng, 0, 10),
      has_frequent_partner_on_service: rng() < 0.5,
      has_trainer_paired: rng() < 0.5,
      ...over,
    },
    slot: {
      service_starts_at: new Date("2026-09-13T12:00:00Z"),
      role_skill_required: pick(rng, SKILLS),
    },
  };
}

// ── 1. score bounds ───────────────────────────────────────────────────────────
describe("scoreCandidate — property: total always within [0,100]", () => {
  it("never escapes the clamp over fuzzed inputs", () => {
    const rng = mulberry32(0xc0ffee);
    for (let i = 0; i < ITER; i++) {
      const b = scoreCandidate(randInput(rng));
      expect(b).not.toBeNull();
      expect(b!.total).toBeGreaterThanOrEqual(0);
      expect(b!.total).toBeLessThanOrEqual(100);
      // total is the (rounded, clamped) sum of contributions
      const raw = b!.components.reduce((s, c) => s + c.contribution, 0);
      expect(b!.total).toBeCloseTo(Math.max(0, Math.min(100, Math.round(raw * 10) / 10)), 6);
    }
  });
});

// ── 2. rotation_fairness monotonic non-decreasing in days-since gap ───────────
describe("scoreCandidate — property: fairness is non-decreasing in the days-since gap", () => {
  it("a larger same-role gap never lowers the fairness contribution", () => {
    const rng = mulberry32(0x1234);
    for (let i = 0; i < ITER; i++) {
      const base = randInput(rng);
      const a = int(rng, 0, 60);
      const bgap = a + int(rng, 0, 60); // bgap >= a
      const mk = (gap: number) => {
        const inp = randInput(rng, {
          ...base.candidate,
          days_since_last_assignment_same_role: gap,
          // pin any-role so the fairness source is unambiguous
          days_since_last_assignment: gap,
        });
        return scoreCandidate(inp)!;
      };
      const fa = mk(a).components.find((c) => c.name === "rotation_fairness")!.contribution;
      const fb = mk(bgap).components.find((c) => c.name === "rotation_fairness")!.contribution;
      expect(fb).toBeGreaterThanOrEqual(fa - 1e-9);
    }
  });
});

// ── 3. consecutiveWeeksServed bounds ──────────────────────────────────────────
describe("consecutiveWeeksServed — property", () => {
  const WEEK_MS = 7 * 86_400_000;

  it("result is in [0, #unique input weeks] and 0 when the latest service is rested away", () => {
    const rng = mulberry32(0xbeef);
    const now = new Date("2026-09-13T12:00:00Z");
    for (let i = 0; i < ITER; i++) {
      const n = int(rng, 0, 8);
      const dates: Date[] = [];
      for (let k = 0; k < n; k++) {
        // within ~1 year before/after now
        const offsetWeeks = int(rng, -60, 4);
        const jitterMs = Math.floor(rng() * WEEK_MS);
        dates.push(new Date(now.getTime() + offsetWeeks * WEEK_MS + jitterMs));
      }
      const run = consecutiveWeeksServed(dates, now);
      expect(run).toBeGreaterThanOrEqual(0);
      // never exceeds the number of distinct weeks supplied
      const uniqueWeeks = new Set(
        dates.map((d) => Math.floor((d.getTime() + 3 * 86_400_000) / WEEK_MS)),
      ).size;
      expect(run).toBeLessThanOrEqual(uniqueWeeks);
      if (dates.length === 0) expect(run).toBe(0);
    }
  });

  it("a member whose every service is >=2 weeks in the past has run 0 (rested)", () => {
    const rng = mulberry32(0xfeed);
    const now = new Date("2026-09-13T12:00:00Z");
    for (let i = 0; i < ITER; i++) {
      const n = int(rng, 1, 6);
      const dates: Date[] = [];
      for (let k = 0; k < n; k++) {
        const weeksBack = int(rng, 2, 50); // all clearly rested
        dates.push(new Date(now.getTime() - weeksBack * WEEK_MS));
      }
      expect(consecutiveWeeksServed(dates, now)).toBe(0);
    }
  });
});

// ── 4. daysBetween sign / antisymmetry on exact day boundaries ────────────────
describe("daysBetween — property", () => {
  const DAY = 86_400_000;
  it("on whole-day instants, daysBetween(a,b) === -(b,a) and sign matches order", () => {
    const rng = mulberry32(0xabcd);
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < ITER; i++) {
      // align both to exact UTC midnights so flooring is symmetric
      const a = new Date(base + int(rng, 0, 800) * DAY);
      const b = new Date(base + int(rng, 0, 800) * DAY);
      const ab = daysBetween(a, b);
      const ba = daysBetween(b, a);
      expect(ab).toBe(-ba);
      expect(Math.sign(ab)).toBe(Math.sign(b.getTime() - a.getTime()));
    }
  });

  it("immune to wall-clock representation — depends only on elapsed ms", () => {
    const rng = mulberry32(0x9999);
    for (let i = 0; i < ITER; i++) {
      const t = base() + Math.floor(rng() * 1e12);
      const deltaDays = int(rng, -30, 30);
      const from = new Date(t);
      const to = new Date(t + deltaDays * DAY);
      expect(daysBetween(from, to)).toBe(deltaDays);
    }
    function base() {
      return Date.UTC(2000, 0, 1);
    }
  });
});

// ── 5. serviceplan bundle round-trip ──────────────────────────────────────────
describe("serviceplan bundle — property: read(serialize(write(x))) recovers x", () => {
  function randPlan(rng: () => number): ServicePlan {
    const id = `svc-${int(rng, 0, 1_000_000)}`;
    const nItems = int(rng, 0, 5);
    const items: ServicePlan["items"] = [];
    for (let i = 0; i < nItems; i++) {
      items.push({
        position: i + 1,
        kind: pick(rng, ["welcome", "song", "scripture", "sermon"]),
        title: `Item ${int(rng, 0, 999)}`,
        song_ref: null,
        scripture_ref: null,
        key_override: null,
        duration_min: int(rng, 0, 60),
        notes: rng() < 0.5 ? null : "n",
      });
    }
    return {
      service: {
        id,
        church_id: `ch-${int(rng, 0, 999)}`,
        name: `Service ${int(rng, 0, 999)}`,
        starts_at: "2026-09-13T09:00:00Z",
        state: pick(rng, ["draft", "published"]),
        was_streamed: rng() < 0.5,
        notes: rng() < 0.5 ? null : "note",
      },
      items,
    };
  }

  it("round-trips structurally over fuzzed plans, with/without an injected clock", () => {
    const rng = mulberry32(0x5eed);
    for (let i = 0; i < ITER; i++) {
      const plan = randPlan(rng);
      const withClock = rng() < 0.5;
      const bundle = writeServicePlanBundle(
        plan,
        withClock ? { now: () => "2026-09-13T09:00:00Z" } : {},
      );
      const wire = serializeServicePlanBundle(bundle);
      const read = readServicePlanBundle(JSON.parse(wire));
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect(read.bundle).toEqual(bundle);
        expect(read.bundle.service_id).toBe(plan.service.id);
        expect(read.bundle.plan).toEqual(plan);
        expect(read.bundle.generated_at).toBe(withClock ? "2026-09-13T09:00:00Z" : null);
      }
    }
  });
});
