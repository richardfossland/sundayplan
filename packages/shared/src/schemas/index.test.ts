import { describe, expect, it } from "vitest";
import {
  AssignmentResponseSchema,
  AvailabilityInputSchema,
  AvailabilityPattern,
  ChurchInputSchema,
  DeliveryInputSchema,
  MagicLinkIssueSchema,
  MemberInputSchema,
  MessageInputSchema,
  MessageTemplateInputSchema,
  ServiceInputSchema,
  ServiceItemInputSchema,
  SongInputSchema,
  OAuthProvider,
  OAUTH_PROVIDERS,
  OAUTH_PROVIDER_LABELS,
  OAUTH_CALLBACK_PATH,
  parseOAuthProvider,
  buildOAuthRedirectTo,
  sanitizeNextPath,
  oauthErrorMessage,
  isEmailVerifiedIdentity,
  isoDate,
  isoDateTime,
  localeCode,
  phoneE164,
} from "./index";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("atoms", () => {
  it("phoneE164 accepts E.164 and rejects malformed numbers", () => {
    expect(phoneE164.safeParse("+4791000001").success).toBe(true);
    expect(phoneE164.safeParse("4791000001").success).toBe(false); // no +
    expect(phoneE164.safeParse("+0123456789").success).toBe(false); // leading 0
    expect(phoneE164.safeParse("+12").success).toBe(false); // too short
  });

  it("isoDate requires YYYY-MM-DD", () => {
    expect(isoDate.safeParse("2026-06-07").success).toBe(true);
    expect(isoDate.safeParse("2026-6-7").success).toBe(false);
    expect(isoDate.safeParse("07/06/2026").success).toBe(false);
  });

  it("isoDateTime requires an offset datetime, not a bare date", () => {
    expect(isoDateTime.safeParse("2026-06-07T09:00:00Z").success).toBe(true);
    expect(isoDateTime.safeParse("2026-06-07T09:00:00+02:00").success).toBe(true);
    expect(isoDateTime.safeParse("2026-06-07").success).toBe(false);
  });

  it("localeCode is the supported set", () => {
    expect(localeCode.safeParse("no").success).toBe(true);
    expect(localeCode.safeParse("es").success).toBe(false);
  });
});

describe("ChurchInputSchema", () => {
  it("applies locale + timezone defaults", () => {
    const c = ChurchInputSchema.parse({ name: "Alta Frikirke", slug: "alta-frikirke" });
    expect(c.locale).toBe("no");
    expect(c.timezone).toBe("Europe/Oslo");
  });

  it("rejects a slug with spaces or uppercase", () => {
    expect(ChurchInputSchema.safeParse({ name: "X", slug: "Alta Frikirke" }).success).toBe(false);
    expect(ChurchInputSchema.safeParse({ name: "X", slug: "Alta" }).success).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(ChurchInputSchema.safeParse({ name: "", slug: "ok-slug" }).success).toBe(false);
  });
});

describe("MemberInputSchema", () => {
  it("applies sensible defaults", () => {
    const m = MemberInputSchema.parse({ display_name: "Maria Hansen" });
    expect(m.language).toBe("no");
    expect(m.preferred_channel).toBe("sms");
    expect(m.status).toBe("active");
    expect(m.tags).toEqual([]);
  });

  it("validates email + phone when present", () => {
    expect(MemberInputSchema.safeParse({ display_name: "X", email: "not-an-email" }).success).toBe(false);
    expect(MemberInputSchema.safeParse({ display_name: "X", phone_e164: "12345" }).success).toBe(false);
    expect(MemberInputSchema.safeParse({ display_name: "X", phone_e164: "+4791000001", email: "x@y.no" }).success).toBe(true);
  });

  it("bounds target_serves_per_month to a sane range", () => {
    expect(MemberInputSchema.safeParse({ display_name: "X", target_serves_per_month: 40 }).success).toBe(false);
    expect(MemberInputSchema.safeParse({ display_name: "X", target_serves_per_month: 2 }).success).toBe(true);
  });
});

describe("AvailabilityPattern union", () => {
  it("accepts each of the three kinds", () => {
    expect(AvailabilityPattern.safeParse({ weekday: "wednesday" }).success).toBe(true);
    expect(AvailabilityPattern.safeParse({ from: "2026-06-01", to: "2026-06-30" }).success).toBe(true);
    expect(AvailabilityPattern.safeParse({ dates: ["2026-06-07"] }).success).toBe(true);
  });

  it("rejects a bad weekday and an empty dates list", () => {
    expect(AvailabilityPattern.safeParse({ weekday: "funday" }).success).toBe(false);
    expect(AvailabilityPattern.safeParse({ dates: [] }).success).toBe(false);
  });

  it("defaults reason_visibility to planner", () => {
    const a = AvailabilityInputSchema.parse({ member_id: UUID, kind: "recurring", pattern: { weekday: "monday" } });
    expect(a.reason_visibility).toBe("planner");
  });
});

describe("ServiceInputSchema", () => {
  it("requires an offset datetime for starts_at_utc", () => {
    expect(ServiceInputSchema.safeParse({ name: "Sunday", starts_at_utc: "2026-06-07T09:00:00Z" }).success).toBe(true);
    expect(ServiceInputSchema.safeParse({ name: "Sunday", starts_at_utc: "2026-06-07" }).success).toBe(false);
  });
});

describe("ServiceItemInputSchema", () => {
  it("defaults duration to 0 and caps it", () => {
    const i = ServiceItemInputSchema.parse({ position: 0, label: "Welcome", kind: "welcome" });
    expect(i.duration_min).toBe(0);
    expect(ServiceItemInputSchema.safeParse({ position: 0, label: "X", kind: "welcome", duration_min: 1000 }).success).toBe(false);
  });
});

describe("SongInputSchema", () => {
  it("bounds tempo and validates URLs", () => {
    expect(SongInputSchema.safeParse({ title: "Oceans", tempo_bpm: 72 }).success).toBe(true);
    expect(SongInputSchema.safeParse({ title: "Oceans", tempo_bpm: 10 }).success).toBe(false);
    expect(SongInputSchema.safeParse({ title: "Oceans", chord_chart_url: "not a url" }).success).toBe(false);
  });

  it("defaults themes + language", () => {
    const s = SongInputSchema.parse({ title: "Oceans" });
    expect(s.themes).toEqual([]);
    expect(s.language).toBe("no");
  });
});

describe("AssignmentResponseSchema", () => {
  it("requires a long token and a valid action", () => {
    expect(AssignmentResponseSchema.safeParse({ token: "x".repeat(24), action: "accept" }).success).toBe(true);
    expect(AssignmentResponseSchema.safeParse({ token: "short", action: "accept" }).success).toBe(false);
    expect(AssignmentResponseSchema.safeParse({ token: "x".repeat(24), action: "nope" }).success).toBe(false);
  });
});

describe("MagicLinkIssueSchema", () => {
  it("defaults TTL to 7 days and bounds it", () => {
    const m = MagicLinkIssueSchema.parse({ member_id: UUID, purpose: "assignment_response" });
    expect(m.ttl_seconds).toBe(60 * 60 * 24 * 7);
    expect(MagicLinkIssueSchema.safeParse({ member_id: UUID, purpose: "generic", ttl_seconds: 10 }).success).toBe(false);
    expect(MagicLinkIssueSchema.safeParse({ member_id: UUID, purpose: "generic", ttl_seconds: 60 * 60 * 24 * 60 }).success).toBe(false);
  });
});

describe("MessageTemplateInputSchema", () => {
  it("applies purpose + language + is_active defaults", () => {
    const t = MessageTemplateInputSchema.parse({ name: "Invite", channel: "sms", body: "Hi {{volunteer_name}}" });
    expect(t.purpose).toBe("custom");
    expect(t.language).toBe("no");
    expect(t.is_active).toBe(true);
  });

  it("rejects an unknown channel and an empty body", () => {
    expect(MessageTemplateInputSchema.safeParse({ name: "X", channel: "carrier_pigeon", body: "x" }).success).toBe(false);
    expect(MessageTemplateInputSchema.safeParse({ name: "X", channel: "sms", body: "" }).success).toBe(false);
  });
});

describe("MessageInputSchema", () => {
  it("requires a channel and a body", () => {
    expect(MessageInputSchema.safeParse({ channel: "email", body: "Hello" }).success).toBe(true);
    expect(MessageInputSchema.safeParse({ channel: "email" }).success).toBe(false);
  });
});

describe("DeliveryInputSchema", () => {
  it("defaults status to queued", () => {
    const d = DeliveryInputSchema.parse({ message_id: UUID, channel: "sms", to_recipient: "+4791000001" });
    expect(d.status).toBe("queued");
  });

  it("accepts skipped with a reason", () => {
    const d = DeliveryInputSchema.parse({
      message_id: UUID,
      channel: "sms",
      to_recipient: "—",
      status: "skipped",
      skip_reason: "no usable channel",
    });
    expect(d.status).toBe("skipped");
    expect(d.skip_reason).toBe("no usable channel");
  });
});

// ── OAuth sign-up (Phase 1.3) ──────────────────────────────────────────────────

describe("OAuthProvider", () => {
  it("accepts the three supported providers", () => {
    expect(OAuthProvider.safeParse("github").success).toBe(true);
    expect(OAuthProvider.safeParse("google").success).toBe(true);
    expect(OAuthProvider.safeParse("apple").success).toBe(true);
  });

  it("rejects unsupported providers", () => {
    expect(OAuthProvider.safeParse("facebook").success).toBe(false);
    expect(OAuthProvider.safeParse("").success).toBe(false);
  });

  it("the canonical list and labels stay in lock-step with the enum", () => {
    expect([...OAUTH_PROVIDERS]).toEqual(["github", "google", "apple"]);
    expect(Object.keys(OAUTH_PROVIDER_LABELS).sort()).toEqual([...OAUTH_PROVIDERS].sort());
    for (const p of OAUTH_PROVIDERS) {
      expect(OAuthProvider.safeParse(p).success).toBe(true);
    }
  });
});

describe("parseOAuthProvider", () => {
  it("returns the canonical provider for valid input", () => {
    expect(parseOAuthProvider("github")).toBe("github");
    expect(parseOAuthProvider("google")).toBe("google");
  });

  it("returns null for unknown / missing values", () => {
    expect(parseOAuthProvider(null)).toBeNull();
    expect(parseOAuthProvider(undefined)).toBeNull();
    expect(parseOAuthProvider("GITHUB")).toBeNull();
    expect(parseOAuthProvider("twitter")).toBeNull();
  });
});

describe("sanitizeNextPath", () => {
  it("passes through same-origin absolute paths", () => {
    expect(sanitizeNextPath("/")).toBe("/");
    expect(sanitizeNextPath("/onboarding")).toBe("/onboarding");
    expect(sanitizeNextPath("/services?x=1")).toBe("/services?x=1");
  });

  it("collapses open-redirect attempts to /", () => {
    expect(sanitizeNextPath("//evil.com")).toBe("/");
    expect(sanitizeNextPath("/\\evil.com")).toBe("/");
    expect(sanitizeNextPath("https://evil.com")).toBe("/");
    expect(sanitizeNextPath("evil.com")).toBe("/");
    expect(sanitizeNextPath("")).toBe("/");
    expect(sanitizeNextPath(null)).toBe("/");
    expect(sanitizeNextPath(undefined)).toBe("/");
  });
});

describe("buildOAuthRedirectTo", () => {
  it("targets the callback route and carries an encoded next param", () => {
    expect(buildOAuthRedirectTo("https://plan.example.com")).toBe(
      "https://plan.example.com/auth/callback?next=%2F",
    );
    expect(buildOAuthRedirectTo("https://plan.example.com", "/onboarding")).toBe(
      "https://plan.example.com/auth/callback?next=%2Fonboarding",
    );
  });

  it("trims trailing slashes from the origin and uses the shared callback path", () => {
    const url = buildOAuthRedirectTo("https://plan.example.com///", "/services");
    expect(url).toContain(`https://plan.example.com${OAUTH_CALLBACK_PATH}`);
    expect(url).not.toContain("com//auth");
  });

  it("refuses to embed an open-redirect via next", () => {
    expect(buildOAuthRedirectTo("https://x.test", "//evil.com")).toBe(
      "https://x.test/auth/callback?next=%2F",
    );
  });
});

describe("oauthErrorMessage", () => {
  it("returns null when there is no error code", () => {
    expect(oauthErrorMessage(null)).toBeNull();
    expect(oauthErrorMessage(undefined)).toBeNull();
    expect(oauthErrorMessage("")).toBeNull();
  });

  it("maps known codes to friendly copy", () => {
    expect(oauthErrorMessage("access_denied")).toMatch(/cancelled/i);
    expect(oauthErrorMessage("provider_email_needs_verification")).toMatch(/verif/i);
    expect(oauthErrorMessage("server_error")).toMatch(/unavailable/i);
  });

  it("falls back to a generic message for unknown codes", () => {
    expect(oauthErrorMessage("weird_code")).toMatch(/couldn't complete/i);
  });
});

describe("isEmailVerifiedIdentity", () => {
  it("is true only when an email is present and verified", () => {
    expect(isEmailVerifiedIdentity({ email: "a@b.com", email_verified: true })).toBe(true);
  });

  it("rejects unverified, missing, or absent emails", () => {
    expect(isEmailVerifiedIdentity({ email: "a@b.com", email_verified: false })).toBe(false);
    expect(isEmailVerifiedIdentity({ email: "a@b.com", email_verified: null })).toBe(false);
    expect(isEmailVerifiedIdentity({ email: null, email_verified: true })).toBe(false);
    expect(isEmailVerifiedIdentity({ email_verified: true })).toBe(false);
    expect(isEmailVerifiedIdentity(null)).toBe(false);
    expect(isEmailVerifiedIdentity(undefined)).toBe(false);
  });
});
