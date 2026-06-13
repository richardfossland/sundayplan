import { describe, it, expect } from "vitest";
import { checkAiQuota, aiLimitFor, AI_PARSES_PER_MONTH } from "./ai-quota";

describe("aiLimitFor", () => {
  it("defaults unknown/empty tier to free", () => {
    expect(aiLimitFor(null)).toBe(AI_PARSES_PER_MONTH.free);
    expect(aiLimitFor("nonsense")).toBe(AI_PARSES_PER_MONTH.free);
    expect(aiLimitFor("growth")).toBe(AI_PARSES_PER_MONTH.growth);
  });
});

describe("checkAiQuota", () => {
  const now = new Date("2026-06-13T10:00:00Z");

  it("allows when under the limit and increments", () => {
    const d = checkAiQuota({ tier: "free", used: 5, usedAtReset: now, now });
    expect(d.allowed).toBe(true);
    expect(d.nextUsed).toBe(6);
    expect(d.remaining).toBe(15);
    expect(d.shouldReset).toBe(false);
  });

  it("denies at the limit", () => {
    const d = checkAiQuota({ tier: "free", used: 20, usedAtReset: now, now });
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(0);
    expect(d.reason).toContain("ai_quota_exceeded");
  });

  it("rolls over when the reset timestamp is a previous UTC month", () => {
    const lastMonth = new Date("2026-05-31T23:00:00Z");
    const d = checkAiQuota({ tier: "free", used: 20, usedAtReset: lastMonth, now });
    expect(d.allowed).toBe(true);
    expect(d.shouldReset).toBe(true);
    expect(d.nextUsed).toBe(1); // counter treated as 0 then +1
  });

  it("treats a negative stored counter as 0", () => {
    const d = checkAiQuota({ tier: "starter", used: -5, usedAtReset: now, now });
    expect(d.allowed).toBe(true);
    expect(d.nextUsed).toBe(1);
  });
});
