import { describe, expect, it, vi } from "vitest";
import type { ScoreBreakdown } from "@sundayplan/shared";
import {
  refineBreakdown,
  rationaleCacheKey,
  type RationaleDraft,
  type RationaleRefiner,
} from "./scoring";
import { getRationaleRefiner } from "./rationale-refiner";

function breakdown(): ScoreBreakdown {
  return {
    total: 72.5,
    warnings: ["Has served 3 weeks in a row — consider rest"],
    components: [
      {
        name: "skill_match",
        weight: 40,
        raw: 0.4,
        contribution: 16,
        explanation: "training level — should pair with a trainer",
      },
      {
        name: "rotation_fairness",
        weight: 25,
        raw: 1,
        contribution: 25,
        explanation: "28 days since last assignment",
      },
    ],
  };
}

/** A refiner that uppercases everything — easy to assert it ran. */
const shoutingRefiner: RationaleRefiner = {
  refine: (d) => ({
    kind: d.kind,
    explanations: d.explanations.map((s) => s.toUpperCase()),
    warnings: d.warnings.map((s) => s.toUpperCase()),
  }),
};

describe("refineBreakdown — offline fallback", () => {
  it("returns the breakdown untouched when no refiner is given", async () => {
    const b = breakdown();
    const out = await refineBreakdown(b);
    expect(out).toBe(b); // identity — the offline default never copies.
  });

  it("returns the breakdown untouched when refiner is null", async () => {
    const b = breakdown();
    const out = await refineBreakdown(b, { refiner: null });
    expect(out).toBe(b);
  });
});

describe("refineBreakdown — with a refiner", () => {
  it("rewrites the text but preserves every number", async () => {
    const out = await refineBreakdown(breakdown(), { refiner: shoutingRefiner });
    expect(out.total).toBe(72.5);
    expect(out.components[0].contribution).toBe(16);
    expect(out.components[1].raw).toBe(1);
    expect(out.components[0].name).toBe("skill_match");
    // text refined
    expect(out.components[0].explanation).toBe(
      "TRAINING LEVEL — SHOULD PAIR WITH A TRAINER",
    );
    expect(out.warnings[0]).toBe("HAS SERVED 3 WEEKS IN A ROW — CONSIDER REST");
  });

  it("keeps the original strings when the refiner throws", async () => {
    const b = breakdown();
    const broken: RationaleRefiner = {
      refine: () => {
        throw new Error("network down");
      },
    };
    const out = await refineBreakdown(b, { refiner: broken });
    expect(out.components[0].explanation).toBe(b.components[0].explanation);
    expect(out.warnings).toEqual(b.warnings);
  });

  it("keeps the original strings when the refiner returns a mis-shaped result", async () => {
    const b = breakdown();
    // Wrong array length → unsafe → fall back.
    const wrongLength: RationaleRefiner = {
      refine: (d) => ({ kind: d.kind, explanations: ["only one"], warnings: [] }),
    };
    const out = await refineBreakdown(b, { refiner: wrongLength });
    expect(out.components[0].explanation).toBe(b.components[0].explanation);

    // Empty strings → unsafe → fall back.
    const blanks: RationaleRefiner = {
      refine: (d) => ({
        kind: d.kind,
        explanations: d.explanations.map(() => "  "),
        warnings: d.warnings.map(() => ""),
      }),
    };
    const out2 = await refineBreakdown(b, { refiner: blanks });
    expect(out2.warnings).toEqual(b.warnings);
  });

  it("supports an async refiner", async () => {
    const asyncRefiner: RationaleRefiner = {
      refine: async (d) => ({
        kind: d.kind,
        explanations: d.explanations.map((s) => `~ ${s}`),
        warnings: d.warnings.map((s) => `~ ${s}`),
      }),
    };
    const out = await refineBreakdown(breakdown(), { refiner: asyncRefiner });
    expect(out.components[0].explanation.startsWith("~ ")).toBe(true);
  });

  it("threads the kind through to the refiner (conflict vs recommendation)", async () => {
    let seen: RationaleDraft["kind"] | null = null;
    const spy: RationaleRefiner = {
      refine: (d) => {
        seen = d.kind;
        return d;
      },
    };
    await refineBreakdown(breakdown(), { refiner: spy, kind: "conflict" });
    expect(seen).toBe("conflict");
  });
});

describe("refineBreakdown — caching", () => {
  it("does not re-request for an identical breakdown signature", async () => {
    const refine = vi.fn((d: RationaleDraft) => d);
    const refiner: RationaleRefiner = { refine };
    const cache = new Map<string, RationaleDraft>();

    await refineBreakdown(breakdown(), { refiner, cache });
    await refineBreakdown(breakdown(), { refiner, cache });
    await refineBreakdown(breakdown(), { refiner, cache });

    expect(refine).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
  });

  it("uses separate cache entries per kind", () => {
    const b = breakdown();
    expect(rationaleCacheKey("conflict", b)).not.toBe(
      rationaleCacheKey("recommendation", b),
    );
  });

  it("re-requests when the rationale text differs", async () => {
    const refine = vi.fn((d: RationaleDraft) => d);
    const refiner: RationaleRefiner = { refine };
    const cache = new Map<string, RationaleDraft>();

    const a = breakdown();
    const c = breakdown();
    c.warnings = ["a different warning"];

    await refineBreakdown(a, { refiner, cache });
    await refineBreakdown(c, { refiner, cache });

    expect(refine).toHaveBeenCalledTimes(2);
  });
});

describe("getRationaleRefiner", () => {
  it("returns null without an API key (offline tier)", () => {
    expect(getRationaleRefiner(undefined)).toBeNull();
    expect(getRationaleRefiner({})).toBeNull();
    expect(getRationaleRefiner({ ANTHROPIC_API_KEY: "   " })).toBeNull();
  });

  it("returns a usable refiner when a key is present", () => {
    const r = getRationaleRefiner({ ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(r).not.toBeNull();
    expect(typeof r!.refine).toBe("function");
  });
});
