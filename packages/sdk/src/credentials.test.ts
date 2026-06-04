import { describe, expect, it } from "vitest";
import {
  isCredentialCurrent,
  missingCredentials,
  isBlockedByCredentials,
  parseCredentialInput,
  parseRequiredCredentials,
  CREDENTIAL_KINDS,
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

  it("treats a date-only expiry as valid through the end of its expiry day", () => {
    // expires_at is a date-only string by convention (DB + <input type=date>);
    // a certification/background-check is valid THROUGH its expiry date, so a
    // credential that expires today must still be current later that same day.
    expect(
      isCredentialCurrent(
        { kind: "cpr", status: "current", expires_at: "2026-06-04" },
        new Date("2026-06-04T14:00:00Z"),
      ),
    ).toBe(true);
    // ...and only stops being current once that day has fully passed.
    expect(
      isCredentialCurrent(
        { kind: "cpr", status: "current", expires_at: "2026-06-04" },
        new Date("2026-06-05T00:00:00Z"),
      ),
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

describe("parseCredentialInput", () => {
  it("accepts a valid submission and trims notes", () => {
    const r = parseCredentialInput({
      kind: "background_check",
      status: "current",
      issued_at: "2026-01-01",
      expires_at: "2027-01-01",
      notes: "  Politiattest  ",
    });
    expect(r).toEqual({
      ok: true,
      value: {
        kind: "background_check",
        status: "current",
        issued_at: "2026-01-01",
        expires_at: "2027-01-01",
        notes: "Politiattest",
      },
    });
  });

  it("treats blank dates and blank notes as null", () => {
    const r = parseCredentialInput({ kind: "cpr", status: "none", issued_at: "", expires_at: "", notes: "  " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.issued_at).toBeNull();
      expect(r.value.expires_at).toBeNull();
      expect(r.value.notes).toBeNull();
    }
  });

  it("rejects an unknown kind or status", () => {
    expect(parseCredentialInput({ kind: "passport", status: "current" }).ok).toBe(false);
    expect(parseCredentialInput({ kind: "cpr", status: "valid" }).ok).toBe(false);
  });

  it("rejects a malformed date", () => {
    expect(parseCredentialInput({ kind: "cpr", status: "current", expires_at: "soon" }).ok).toBe(false);
  });

  it("rejects an expiry before the issue date", () => {
    const r = parseCredentialInput({
      kind: "cpr",
      status: "current",
      issued_at: "2026-06-01",
      expires_at: "2026-01-01",
    });
    expect(r.ok).toBe(false);
  });
});

describe("parseRequiredCredentials", () => {
  it("keeps only valid kinds, de-duplicated, in canonical order", () => {
    expect(parseRequiredCredentials(["safeguarding", "cpr", "cpr", "garbage"])).toEqual([
      "cpr",
      "safeguarding",
    ]);
  });

  it("returns an empty array when nothing valid is submitted", () => {
    expect(parseRequiredCredentials([])).toEqual([]);
    expect(parseRequiredCredentials(["nope", 7, null])).toEqual([]);
  });

  it("preserves every kind when all are submitted", () => {
    expect(parseRequiredCredentials([...CREDENTIAL_KINDS])).toEqual([...CREDENTIAL_KINDS]);
  });
});
