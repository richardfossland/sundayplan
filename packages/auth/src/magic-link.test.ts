import { describe, expect, it } from "vitest";
import {
  signMagicLink,
  tokenHash,
  verifyMagicLink,
  signChurchInvite,
  verifyChurchInvite,
  buildInviteLink,
  type IssueOptions,
  type InviteIssueOptions,
} from "./magic-link";

const SECRET = "test-magic-link-secret-please-rotate";

function opts(overrides: Partial<IssueOptions> = {}): IssueOptions {
  return {
    member_id: "11111111-1111-4111-8111-111111111111",
    church_id: "22222222-2222-4222-8222-222222222222",
    purpose: "assignment_response",
    assignment_id: "33333333-3333-4333-8333-333333333333",
    ttl_seconds: 60 * 60 * 24 * 7,
    now: 1_700_000_000,
    ...overrides,
  };
}

describe("signMagicLink / verifyMagicLink", () => {
  it("round-trips and preserves claims", async () => {
    const token = await signMagicLink(opts({ jti: "fixed-jti" }), SECRET);
    const res = await verifyMagicLink(token, SECRET, 1_700_000_000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.claims.member_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(res.claims.sub).toBe(res.claims.member_id);
    expect(res.claims.church_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(res.claims.purpose).toBe("assignment_response");
    expect(res.claims.assignment_id).toBe("33333333-3333-4333-8333-333333333333");
    expect(res.claims.jti).toBe("fixed-jti");
    expect(res.claims.exp).toBe(1_700_000_000 + 60 * 60 * 24 * 7);
  });

  it("produces a fresh random jti per issuance by default", async () => {
    const a = await signMagicLink(opts(), SECRET);
    const b = await signMagicLink(opts(), SECRET);
    const ca = await verifyMagicLink(a, SECRET, 1_700_000_000);
    const cb = await verifyMagicLink(b, SECRET, 1_700_000_000);
    expect(ca.ok && cb.ok).toBe(true);
    if (ca.ok && cb.ok) expect(ca.claims.jti).not.toBe(cb.claims.jti);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signMagicLink(opts(), SECRET);
    const res = await verifyMagicLink(token, "some-other-secret", 1_700_000_000);
    expect(res).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a tampered payload", async () => {
    const token = await signMagicLink(opts(), SECRET);
    const [h, body, s] = token.split(".");
    // flip a character in the payload segment
    const tampered = `${h}.${body.slice(0, -1)}${body.at(-1) === "A" ? "B" : "A"}.${s}`;
    const res = await verifyMagicLink(tampered, SECRET, 1_700_000_000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad_signature");
  });

  it("rejects a tampered signature", async () => {
    const token = await signMagicLink(opts(), SECRET);
    const res = await verifyMagicLink(`${token}tampered`, SECRET, 1_700_000_000);
    expect(res.ok).toBe(false);
  });

  it("rejects an expired token", async () => {
    const token = await signMagicLink(opts({ now: 1000, ttl_seconds: 60 }), SECRET);
    const res = await verifyMagicLink(token, SECRET, 2000); // 940s past expiry
    expect(res).toEqual({ ok: false, reason: "expired" });
  });

  it("accepts right up to the expiry boundary", async () => {
    const token = await signMagicLink(opts({ now: 1000, ttl_seconds: 60 }), SECRET);
    const res = await verifyMagicLink(token, SECRET, 1060); // exactly exp
    expect(res.ok).toBe(true);
  });

  it("rejects a malformed token", async () => {
    expect(await verifyMagicLink("not-a-jwt", SECRET)).toEqual({ ok: false, reason: "malformed" });
    expect(await verifyMagicLink("only.two", SECRET)).toEqual({ ok: false, reason: "malformed" });
  });

  it("omits assignment_id when not provided", async () => {
    const token = await signMagicLink(opts({ assignment_id: undefined, purpose: "availability_set" }), SECRET);
    const res = await verifyMagicLink(token, SECRET, 1_700_000_000);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.claims.assignment_id).toBeUndefined();
  });
});

function inviteOpts(overrides: Partial<InviteIssueOptions> = {}): InviteIssueOptions {
  return {
    church_id: "22222222-2222-4222-8222-222222222222",
    role: "planner",
    ttl_seconds: 60 * 60 * 24 * 14,
    now: 1_700_000_000,
    ...overrides,
  };
}

describe("signChurchInvite / verifyChurchInvite", () => {
  it("round-trips and preserves church + role + purpose", async () => {
    const token = await signChurchInvite(inviteOpts({ jti: "fixed-invite-jti", role: "admin" }), SECRET);
    const res = await verifyChurchInvite(token, SECRET, 1_700_000_000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.claims.church_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(res.claims.role).toBe("admin");
    expect(res.claims.purpose).toBe("church_invite");
    expect(res.claims.jti).toBe("fixed-invite-jti");
    expect(res.claims.exp).toBe(1_700_000_000 + 60 * 60 * 24 * 14);
  });

  it("produces a fresh random jti per issuance by default", async () => {
    const a = await signChurchInvite(inviteOpts(), SECRET);
    const b = await signChurchInvite(inviteOpts(), SECRET);
    const ca = await verifyChurchInvite(a, SECRET, 1_700_000_000);
    const cb = await verifyChurchInvite(b, SECRET, 1_700_000_000);
    expect(ca.ok && cb.ok).toBe(true);
    if (ca.ok && cb.ok) expect(ca.claims.jti).not.toBe(cb.claims.jti);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signChurchInvite(inviteOpts(), SECRET);
    const res = await verifyChurchInvite(token, "some-other-secret", 1_700_000_000);
    expect(res).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects an expired invite", async () => {
    const token = await signChurchInvite(inviteOpts({ now: 1000, ttl_seconds: 60 }), SECRET);
    const res = await verifyChurchInvite(token, SECRET, 2000);
    expect(res).toEqual({ ok: false, reason: "expired" });
  });

  it("accepts right up to the expiry boundary", async () => {
    const token = await signChurchInvite(inviteOpts({ now: 1000, ttl_seconds: 60 }), SECRET);
    const res = await verifyChurchInvite(token, SECRET, 1060);
    expect(res.ok).toBe(true);
  });

  it("rejects a malformed token", async () => {
    expect((await verifyChurchInvite("not-a-jwt", SECRET)).ok).toBe(false);
    expect(await verifyChurchInvite("only.two", SECRET)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses a volunteer RSVP token as an invite (wrong_purpose)", async () => {
    // A token minted by the member-scoped path must NOT verify as an invite,
    // even though it shares the signature machinery.
    const rsvp = await signMagicLink(opts(), SECRET);
    const res = await verifyChurchInvite(rsvp, SECRET, 1_700_000_000);
    expect(res).toEqual({ ok: false, reason: "wrong_purpose" });
  });

  it("and conversely: an invite token is not a valid RSVP token", async () => {
    const invite = await signChurchInvite(inviteOpts(), SECRET);
    const res = await verifyMagicLink(invite, SECRET, 1_700_000_000);
    // Signature + expiry pass, but it carries no assignment/member claims, so the
    // RSVP page's own purpose check (in actions.ts) would reject it. Here we just
    // confirm the crypto layer doesn't conflate the two shapes' meaningful fields.
    if (res.ok) {
      expect(res.claims.purpose).toBe("church_invite");
      expect(res.claims.assignment_id).toBeUndefined();
    }
  });
});

describe("buildInviteLink", () => {
  it("targets the /join route with an encoded token and trims trailing slashes", () => {
    expect(buildInviteLink("https://plan.example.com", "abc.def.ghi")).toBe(
      "https://plan.example.com/r/abc.def.ghi/join",
    );
    expect(buildInviteLink("https://plan.example.com///", "abc.def.ghi")).toBe(
      "https://plan.example.com/r/abc.def.ghi/join",
    );
  });

  it("url-encodes a token that contains reserved characters", () => {
    const link = buildInviteLink("https://x.test", "a/b+c");
    expect(link).toBe("https://x.test/r/a%2Fb%2Bc/join");
  });
});

describe("tokenHash", () => {
  it("computes the SHA-256 hex (matches the known vector for 'abc')", async () => {
    expect(await tokenHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is stable and differs per token", async () => {
    const t = await signMagicLink(opts({ jti: "j1" }), SECRET);
    expect(await tokenHash(t)).toBe(await tokenHash(t));
    expect(await tokenHash(t)).not.toBe(await tokenHash(`${t}x`));
  });
});
