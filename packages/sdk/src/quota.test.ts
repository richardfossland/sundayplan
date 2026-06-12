import { describe, expect, it } from "vitest";
import { schemas } from "@sundayplan/shared";
import { TIER_LIMITS, checkPeopleLimit, checkSmsQuota, limitsFor } from "./quota";

it("covers exactly the tiers the shared schema defines", () => {
  expect(Object.keys(TIER_LIMITS).sort()).toEqual([...schemas.ChurchPlanTier.options].sort());
});

const inJune = new Date("2026-06-12T10:00:00Z");

describe("limitsFor", () => {
  it("maps tiers and falls back to free for unknown/missing", () => {
    expect(limitsFor("growth")).toEqual(TIER_LIMITS.growth);
    expect(limitsFor(null)).toEqual(TIER_LIMITS.free);
    expect(limitsFor("enterprise-nonsense")).toEqual(TIER_LIMITS.free);
  });
});

describe("checkSmsQuota", () => {
  it("allows a send within quota and returns the counter to persist", () => {
    const d = checkSmsQuota(
      { tier: "free", used: 10, usedAtReset: "2026-06-01T00:00:00Z", now: inJune },
      3,
    );
    expect(d).toMatchObject({ allowed: true, remaining: 40, nextUsed: 13, shouldReset: false });
  });

  it("refuses when the send would overrun the month's allowance", () => {
    const d = checkSmsQuota(
      { tier: "free", used: 49, usedAtReset: "2026-06-01T00:00:00Z", now: inJune },
      2,
    );
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(1);
    expect(d.reason).toContain("sms_quota_exceeded");
    expect(d.reason).toContain("free");
  });

  it("rolls the counter over implicitly in a new UTC month", () => {
    const d = checkSmsQuota(
      { tier: "free", used: 50, usedAtReset: "2026-05-20T00:00:00Z", now: inJune },
      5,
    );
    expect(d).toMatchObject({ allowed: true, nextUsed: 5, shouldReset: true });
  });

  it("does NOT roll over within the same month", () => {
    const d = checkSmsQuota(
      { tier: "free", used: 50, usedAtReset: "2026-06-01T00:00:00Z", now: inJune },
      1,
    );
    expect(d.allowed).toBe(false);
    expect(d.shouldReset).toBe(false);
  });

  it("scales the allowance with the tier", () => {
    const d = checkSmsQuota(
      { tier: "growth", used: 1500, usedAtReset: "2026-06-01T00:00:00Z", now: inJune },
      400,
    );
    expect(d.allowed).toBe(true);
    expect(d.nextUsed).toBe(1900);
  });

  it("treats a negative stored counter defensively as 0", () => {
    const d = checkSmsQuota(
      { tier: "free", used: -7, usedAtReset: "2026-06-01T00:00:00Z", now: inJune },
      1,
    );
    expect(d.nextUsed).toBe(1);
  });
});

describe("checkPeopleLimit", () => {
  it("enforces the roster cap per tier", () => {
    expect(checkPeopleLimit("free", 50)).toBe(true);
    expect(checkPeopleLimit("free", 51)).toBe(false);
    expect(checkPeopleLimit("network", 5000)).toBe(true);
  });
});
