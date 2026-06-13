import { beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimit, clientIp, rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => __resetRateLimit());

  it("allows up to the limit then blocks within the window", () => {
    const opts = { limit: 3, windowMs: 60_000, now: 1_000 };
    expect(rateLimit("k", opts).ok).toBe(true); // 1
    expect(rateLimit("k", opts).ok).toBe(true); // 2
    const third = rateLimit("k", opts); // 3 (last allowed)
    expect(third.ok).toBe(true);
    expect(third.remaining).toBe(0);
    expect(rateLimit("k", opts).ok).toBe(false); // 4 → blocked
  });

  it("resets after the window elapses", () => {
    expect(rateLimit("k", { limit: 1, windowMs: 1_000, now: 0 }).ok).toBe(true);
    expect(rateLimit("k", { limit: 1, windowMs: 1_000, now: 500 }).ok).toBe(false);
    // Window passed → fresh bucket.
    expect(rateLimit("k", { limit: 1, windowMs: 1_000, now: 1_500 }).ok).toBe(true);
  });

  it("scopes independently per key", () => {
    const opts = { limit: 1, windowMs: 60_000, now: 0 };
    expect(rateLimit("ip-a:slug", opts).ok).toBe(true);
    expect(rateLimit("ip-b:slug", opts).ok).toBe(true);
    expect(rateLimit("ip-a:slug", opts).ok).toBe(false);
  });
});

describe("clientIp", () => {
  it("prefers cf-connecting-ip, then x-real-ip, then first x-forwarded-for", () => {
    expect(clientIp(new Headers({ "cf-connecting-ip": "1.1.1.1" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-real-ip": "2.2.2.2" }))).toBe("2.2.2.2");
    expect(clientIp(new Headers({ "x-forwarded-for": "3.3.3.3, 4.4.4.4" }))).toBe("3.3.3.3");
  });

  it("falls back to 'unknown' with no proxy headers", () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
