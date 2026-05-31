import { describe, expect, it } from "vitest";
import {
  SUITE_LOCALES,
  assignmentTemplate,
  buildAssignmentMessage,
  resolveLocale,
  type AssignmentFacts,
  type AssignmentMessagePurpose,
  type SuiteLocale,
} from "./templates";

const facts: AssignmentFacts = {
  memberName: "Maria",
  roleName: "Drums",
  serviceName: "Sunday Morning",
  serviceDate: "13 Sep",
  magicLinkUrl: "https://plan.example/r/abc123",
};

const PURPOSES: AssignmentMessagePurpose[] = ["invite", "reminder", "confirmation"];

// ── Locale resolution ────────────────────────────────────────────────────────────

describe("resolveLocale", () => {
  it("passes through supported locales", () => {
    for (const l of SUITE_LOCALES) expect(resolveLocale(l)).toBe(l);
  });

  it("falls back to en for unknown locales and null/undefined", () => {
    expect(resolveLocale("es")).toBe("en");
    expect(resolveLocale("zz")).toBe("en");
    expect(resolveLocale(null)).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });

  it("strips region tags and maps Norwegian variants to 'no'", () => {
    expect(resolveLocale("en-US")).toBe("en");
    expect(resolveLocale("de_DE")).toBe("de");
    expect(resolveLocale("nb-NO")).toBe("no");
    expect(resolveLocale("nn")).toBe("no");
    expect(resolveLocale("FR")).toBe("fr");
  });
});

// ── Every locale × purpose × channel renders + interpolates ────────────────────────

describe("buildAssignmentMessage — coverage of all locales", () => {
  for (const locale of SUITE_LOCALES) {
    for (const purpose of PURPOSES) {
      it(`renders ${locale}/${purpose} for SMS + email with no leftover tokens`, () => {
        for (const channel of ["sms", "email"] as const) {
          const msg = buildAssignmentMessage(purpose, channel, locale, facts);
          expect(msg.locale).toBe(locale);
          expect(msg.purpose).toBe(purpose);
          expect(msg.channel).toBe(channel);

          // All facts interpolated.
          expect(msg.body).toContain("Maria");
          expect(msg.body).toContain("Drums");
          expect(msg.body).toContain("Sunday Morning");
          expect(msg.body).toContain("13 Sep");
          // No un-substituted template tokens remain.
          expect(msg.body).not.toMatch(/\{\{.*?\}\}/);

          if (channel === "email") {
            expect(msg.subject).not.toBeNull();
            expect(msg.subject).not.toMatch(/\{\{.*?\}\}/);
          } else {
            expect(msg.subject).toBeNull();
          }
        }
      });
    }
  }
});

// ── Magic-link handling ────────────────────────────────────────────────────────────

describe("buildAssignmentMessage — magic link", () => {
  it("interpolates the supplied magic-link URL (invite + reminder carry it)", () => {
    const invite = buildAssignmentMessage("invite", "sms", "en", facts);
    expect(invite.body).toContain("https://plan.example/r/abc123");
    const reminder = buildAssignmentMessage("reminder", "email", "no", facts);
    expect(reminder.body).toContain("https://plan.example/r/abc123");
  });

  it("keeps the {{accept_link}} placeholder when no URL is supplied", () => {
    const { magicLinkUrl: _omit, ...noLink } = facts;
    const msg = buildAssignmentMessage("invite", "sms", "en", noLink);
    expect(msg.body).toContain("{{accept_link}}");
  });

  it("treats an empty-string URL as 'no link' (placeholder kept)", () => {
    const msg = buildAssignmentMessage("invite", "sms", "en", { ...facts, magicLinkUrl: "" });
    expect(msg.body).toContain("{{accept_link}}");
  });
});

// ── Fallback for missing locale ────────────────────────────────────────────────────

describe("buildAssignmentMessage — fallback", () => {
  it("falls back to the en body for an unsupported locale", () => {
    const fallback = buildAssignmentMessage("invite", "sms", "es", facts);
    const en = buildAssignmentMessage("invite", "sms", "en", facts);
    expect(fallback.locale).toBe("en");
    expect(fallback.body).toBe(en.body);
  });
});

// ── Locale-distinctness sanity (templates aren't accidentally all English) ─────────

describe("locale bundles are distinct", () => {
  it("uses locale-specific greetings", () => {
    const greeting = (l: SuiteLocale) =>
      buildAssignmentMessage("invite", "sms", l, facts).body.split(" ")[0];
    expect(greeting("no")).toBe("Hei");
    expect(greeting("en")).toBe("Hi");
    expect(greeting("sv")).toBe("Hej");
    expect(greeting("da")).toBe("Hej");
    expect(greeting("de")).toBe("Hallo");
    expect(greeting("fr")).toBe("Bonjour");
    expect(greeting("pl")).toBe("Cześć");
  });
});

// ── Raw template access ────────────────────────────────────────────────────────────

describe("assignmentTemplate", () => {
  it("returns the raw, un-interpolated strings with their tokens intact", () => {
    const t = assignmentTemplate("invite", "no");
    expect(t.sms).toContain("{{volunteer_name}}");
    expect(t.subject).toContain("{{service_title}}");
    expect(t.email).toContain("{{accept_link}}");
  });

  it("falls back to en for an unknown locale", () => {
    expect(assignmentTemplate("reminder", "es")).toEqual(assignmentTemplate("reminder", "en"));
  });
});
