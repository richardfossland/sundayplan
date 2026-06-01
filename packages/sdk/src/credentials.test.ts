import { describe, expect, it } from "vitest";
import {
  isCredentialCurrent,
  missingCredentials,
  isBlockedByCredentials,
  type MemberCredential,
} from "./credentials";

const NOW = new Date("2026-01-15T00:00:00Z");

describe("isCredentialCurrent", () => {
  it("is false when the credential is missing", () => {
    expect(isCredentialCurrent(undefined, NOW)).toBe(false);
  });

  it("is false unless status is 'current'", () => {
    for (const status of ["pending", "expired", "none"] as const) {
      expect(isCredentialCurrent({ kind: "background_check", status }, NOW)).toBe(false);
    }
  });

  it("is true when current with no expiry", () => {
    expect(isCredentialCurrent({ kind: "background_check", status: "current" }, NOW)).toBe(true);
  });

  it("respects the expiry date", () => {
    expect(
      isCredentialCurrent({ kind: "cpr", status: "current", expires_at: "2026-02-01" }, NOW),
    ).toBe(true);
    expect(
      isCredentialCurrent({ kind: "cpr", status: "current", expires_at: "2026-01-01" }, NOW),
    ).toBe(false);
  });
});

describe("missingCredentials / isBlockedByCredentials", () => {
  const held: MemberCredential[] = [
    { kind: "background_check", status: "current" },
    { kind: "cpr", status: "expired" },
  ];

  it("lists required credentials that aren't current", () => {
    expect(missingCredentials(["background_check", "cpr", "safeguarding"], held, NOW)).toEqual([
      "cpr",
      "safeguarding",
    ]);
  });

  it("clears a member who holds every required credential", () => {
    expect(missingCredentials(["background_check"], held, NOW)).toEqual([]);
    expect(isBlockedByCredentials(["background_check"], held, NOW)).toBe(false);
  });

  it("blocks when any required credential is missing or expired", () => {
    expect(isBlockedByCredentials(["background_check", "cpr"], held, NOW)).toBe(true);
  });

  it("requires nothing → never blocked", () => {
    expect(isBlockedByCredentials([], held, NOW)).toBe(false);
  });
});
