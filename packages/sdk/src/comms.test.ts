import { describe, expect, it } from "vitest";
import {
  DEFAULT_CADENCE,
  daysBetween,
  dueMessages,
  extractVariables,
  formatEmail,
  formatForChannel,
  formatPush,
  formatSms,
  renderTemplate,
  resolveRecipients,
  type ResolvableMember,
} from "./comms";

// ── Template rendering ────────────────────────────────────────────────────────

describe("renderTemplate", () => {
  it("interpolates known variables and tolerates inner whitespace", () => {
    const r = renderTemplate("Hi {{volunteer_name}}, you're on {{ role_name }}", {
      volunteer_name: "Maria",
      role_name: "Drums",
    });
    expect(r.text).toBe("Hi Maria, you're on Drums");
    expect(r.missing).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.used.sort()).toEqual(["role_name", "volunteer_name"]);
  });

  it("reports missing known variables and blanks them", () => {
    const r = renderTemplate("Hi {{volunteer_name}} on {{service_date}}", {
      volunteer_name: "Per",
    });
    expect(r.text).toBe("Hi Per on ");
    expect(r.missing).toEqual(["service_date"]);
  });

  it("reports and strips unknown tokens", () => {
    const r = renderTemplate("Hello {{wat}} {{volunteer_name}}", { volunteer_name: "Liv" });
    expect(r.text).toBe("Hello  Liv");
    expect(r.unknown).toEqual(["wat"]);
  });

  it("treats empty-string values as missing", () => {
    const r = renderTemplate("Link: {{accept_link}}", { accept_link: "" });
    expect(r.missing).toEqual(["accept_link"]);
  });
});

describe("extractVariables", () => {
  it("separates known from unknown tokens", () => {
    const { known, unknown } = extractVariables("{{volunteer_name}} {{role_name}} {{nope}}");
    expect(known.sort()).toEqual(["role_name", "volunteer_name"]);
    expect(unknown).toEqual(["nope"]);
  });
});

// ── SMS segmentation ──────────────────────────────────────────────────────────

describe("formatSms", () => {
  it("treats a short ASCII body as one GSM-7 segment", () => {
    const f = formatSms("See you Sunday!");
    expect(f.encoding).toBe("GSM-7");
    expect(f.characters).toBe(15);
    expect(f.segments).toBe(1);
  });

  it("uses 160 chars for a single GSM-7 segment, 153 thereafter", () => {
    expect(formatSms("a".repeat(160)).segments).toBe(1);
    expect(formatSms("a".repeat(161)).segments).toBe(2);
    expect(formatSms("a".repeat(306)).segments).toBe(2); // 2*153
    expect(formatSms("a".repeat(307)).segments).toBe(3);
  });

  it("switches to UCS-2 with a 70/67 budget when a non-GSM char appears", () => {
    const f = formatSms("emoji 🎉");
    expect(f.encoding).toBe("UCS-2");
    expect(f.segments).toBe(1);
    expect(formatSms("é".repeat(71)).segments).toBe(1 + 0); // é is GSM-7
    expect(formatSms("🎉".repeat(71)).segments).toBe(2); // 71 > 70
  });

  it("counts GSM-7 extended chars as two", () => {
    const f = formatSms("price €5");
    expect(f.encoding).toBe("GSM-7");
    // 'price ' = 6, '€' = 2, '5' = 1
    expect(f.characters).toBe(9);
  });

  it("an empty body is one segment", () => {
    expect(formatSms("").segments).toBe(1);
  });
});

// ── Email + push formatting ───────────────────────────────────────────────────

describe("formatEmail", () => {
  it("falls back to a default subject when blank", () => {
    expect(formatEmail("", "body").subject).toBe("A message from your church");
    expect(formatEmail("Roster", "body").subject).toBe("Roster");
  });
});

describe("formatPush", () => {
  it("truncates a long body with an ellipsis", () => {
    const p = formatPush("Title", "x".repeat(200));
    expect(p.body.length).toBe(178);
    expect(p.body.endsWith("…")).toBe(true);
  });

  it("uses a default title when blank", () => {
    expect(formatPush("", "hi").title).toBe("SundayPlan");
  });
});

describe("formatForChannel", () => {
  it("dispatches to the right formatter", () => {
    expect((formatForChannel("sms", null, "hi") as { segments: number }).segments).toBe(1);
    expect((formatForChannel("email", "S", "b") as { subject: string }).subject).toBe("S");
    expect((formatForChannel("push", "T", "b") as { title: string }).title).toBe("T");
  });
});

// ── Recipient resolution ──────────────────────────────────────────────────────

const maria: ResolvableMember = {
  member_id: "m1",
  display_name: "Maria",
  phone_e164: "+4791000001",
  email: "maria@example.no",
  preferred_channel: "sms",
};
const per: ResolvableMember = {
  member_id: "m2",
  display_name: "Per",
  phone_e164: null,
  email: "per@example.no",
  preferred_channel: "sms",
};
const ghost: ResolvableMember = {
  member_id: "m3",
  display_name: "Ghost",
  phone_e164: null,
  email: null,
  preferred_channel: "email",
};

describe("resolveRecipients", () => {
  it("renders per-recipient values and honours the preferred channel", () => {
    const res = resolveRecipients(
      "Hi {{volunteer_name}}",
      [maria],
      { m1: { volunteer_name: "Maria" } },
    );
    expect(res.skipped).toEqual([]);
    expect(res.recipients).toHaveLength(1);
    expect(res.recipients[0].channel).toBe("sms");
    expect(res.recipients[0].to_recipient).toBe("+4791000001");
    expect((res.recipients[0].rendered as { body: string }).body).toBe("Hi Maria");
  });

  it("falls back to email when the preferred SMS channel is unusable", () => {
    const res = resolveRecipients("Hi", [per], { m2: {} });
    expect(res.recipients[0].channel).toBe("email");
    expect(res.recipients[0].to_recipient).toBe("per@example.no");
  });

  it("skips a member with no usable channel, with a reason", () => {
    const res = resolveRecipients("Hi", [ghost], { m3: {} });
    expect(res.recipients).toEqual([]);
    expect(res.skipped).toEqual([
      { member_id: "m3", display_name: "Ghost", reason: "no_usable_channel" },
    ]);
  });

  it("forces a channel and skips members who can't receive it", () => {
    const res = resolveRecipients("Hi", [maria, per], { m1: {}, m2: {} }, { channel: "sms" });
    expect(res.recipients.map((r) => r.member_id)).toEqual(["m1"]);
    expect(res.skipped).toEqual([{ member_id: "m2", display_name: "Per", reason: "no_phone" }]);
  });

  it("surfaces missing template variables per recipient", () => {
    const res = resolveRecipients("Hi {{volunteer_name}} {{accept_link}}", [maria], {
      m1: { volunteer_name: "Maria" },
    });
    expect(res.recipients[0].missing).toEqual(["accept_link"]);
  });
});

// ── Cadence / scheduling ──────────────────────────────────────────────────────

function at(iso: string): Date {
  return new Date(iso);
}

describe("daysBetween", () => {
  it("floors to whole days", () => {
    expect(daysBetween(at("2026-09-01T00:00:00Z"), at("2026-09-08T00:00:00Z"))).toBe(7);
    expect(daysBetween(at("2026-09-01T12:00:00Z"), at("2026-09-02T06:00:00Z"))).toBe(0);
  });

  it("counts elapsed UTC milliseconds, immune to a wall-clock DST shift", () => {
    // Europe/Oslo springs forward 2026-03-29 (CEST starts). The two instants are
    // exactly 7 * 24h apart in real (UTC) time even though the local clock jumped
    // an hour — daysBetween works on getTime() so it must still report 7, not 6.
    const beforeDst = at("2026-03-26T10:00:00Z");
    const afterDst = at("2026-04-02T10:00:00Z");
    expect(daysBetween(beforeDst, afterDst)).toBe(7);

    // Autumn fall-back (2026-10-25, CEST→CET) — the extra hour must not bump the
    // floored day count up either.
    const beforeFall = at("2026-10-22T10:00:00Z");
    const afterFall = at("2026-10-29T10:00:00Z");
    expect(daysBetween(beforeFall, afterFall)).toBe(7);
  });

  it("returns a negative count when `to` precedes `from`", () => {
    expect(daysBetween(at("2026-09-08T00:00:00Z"), at("2026-09-01T00:00:00Z"))).toBe(-7);
  });

  it("floors a partial-day gap to 0, and never rounds up across a sub-day boundary", () => {
    // 23h59m apart but spanning midnight: still 0 whole days.
    expect(daysBetween(at("2026-09-01T00:01:00Z"), at("2026-09-02T00:00:00Z"))).toBe(0);
    // exactly 24h → 1.
    expect(daysBetween(at("2026-09-01T00:00:00Z"), at("2026-09-02T00:00:00Z"))).toBe(1);
  });
});

describe("dueMessages", () => {
  const service = at("2026-09-13T09:00:00Z"); // a Sunday

  it("sends the invite immediately and just once", () => {
    const first = dueMessages({ now: at("2026-09-01T08:00:00Z"), service_starts_at: service });
    expect(first.map((m) => m.purpose)).toContain("invite");

    const second = dueMessages({
      now: at("2026-09-01T08:00:00Z"),
      service_starts_at: service,
      invite_sent: true,
    });
    expect(second.map((m) => m.purpose)).not.toContain("invite");
  });

  it("queues the standard reminder on the configured day-before window", () => {
    // default reminder is 7 days before → now = service - 7d
    const due = dueMessages({
      now: at("2026-09-06T09:00:00Z"),
      service_starts_at: service,
      invite_sent: true,
    });
    expect(due.map((m) => m.purpose)).toEqual(["reminder"]);
    expect(due[0].days_until_service).toBe(7);
  });

  it("queues the final reminder the day before and suppresses a same-window reminder", () => {
    const cadence = { ...DEFAULT_CADENCE, reminder_days_before: [7, 1] };
    const due = dueMessages({
      now: at("2026-09-12T09:00:00Z"), // 1 day before
      service_starts_at: service,
      invite_sent: true,
      cadence,
    });
    expect(due.map((m) => m.purpose)).toEqual(["final_reminder"]);
  });

  it("does not re-queue a purpose already sent", () => {
    const due = dueMessages({
      now: at("2026-09-06T09:00:00Z"),
      service_starts_at: service,
      invite_sent: true,
      already_sent: ["reminder"],
    });
    expect(due).toEqual([]);
  });

  it("sends nothing once the service is in the past", () => {
    const due = dueMessages({ now: at("2026-09-14T09:00:00Z"), service_starts_at: service });
    expect(due).toEqual([]);
  });

  it("is deterministic — same inputs, same output", () => {
    const input = { now: at("2026-09-06T09:00:00Z"), service_starts_at: service, invite_sent: true };
    expect(dueMessages(input)).toEqual(dueMessages(input));
  });

  // ── Boundary / off-by-one hardening ─────────────────────────────────────────

  it("fires a same-day (0-day) reminder window without treating the service as past", () => {
    // now is a few hours before the service on the same UTC day → daysUntil == 0.
    const cadence = { ...DEFAULT_CADENCE, reminder_days_before: [0], final_reminder_days_before: -1 };
    const due = dueMessages({
      now: at("2026-09-13T06:00:00Z"),
      service_starts_at: service,
      invite_sent: true,
      cadence,
    });
    expect(due.map((m) => m.purpose)).toEqual(["reminder"]);
    expect(due[0].days_until_service).toBe(0);
  });

  it("fires a same-day (0-day) final reminder when the final window collapses to today", () => {
    const cadence = { ...DEFAULT_CADENCE, reminder_days_before: [], final_reminder_days_before: 0 };
    const due = dueMessages({
      now: at("2026-09-13T06:00:00Z"),
      service_starts_at: service,
      invite_sent: true,
      cadence,
    });
    expect(due.map((m) => m.purpose)).toEqual(["final_reminder"]);
    expect(due[0].days_until_service).toBe(0);
  });

  it("treats just-started (daysUntil 0 by flooring) as still due, but a fully-past service as silent", () => {
    // 09:00 service, now 09:30 same day: getTime diff is negative → daysUntil -1 → past.
    const justAfter = dueMessages({
      now: at("2026-09-13T09:30:00Z"),
      service_starts_at: service,
    });
    expect(justAfter).toEqual([]);
    // now 00:30 same day: still ahead of the 09:00 service → daysUntil 0 → invite due.
    const sameDayBefore = dueMessages({
      now: at("2026-09-13T00:30:00Z"),
      service_starts_at: service,
    });
    expect(sameDayBefore.map((m) => m.purpose)).toContain("invite");
  });

  it("keeps reminder windows correct across a spring-forward DST boundary", () => {
    // Service the Sunday after Oslo springs forward; reminder 7 days before.
    const dstService = at("2026-04-05T09:00:00Z");
    const due = dueMessages({
      now: at("2026-03-29T09:00:00Z"), // 7 UTC-days before, the DST-shift day itself
      service_starts_at: dstService,
      invite_sent: true,
    });
    expect(due.map((m) => m.purpose)).toEqual(["reminder"]);
    expect(due[0].days_until_service).toBe(7);
  });

  it("emits only the final reminder when a day is both a reminder window and the final window", () => {
    // daysUntil 1 is in reminder_days_before AND equals final_reminder_days_before.
    const cadence = { ...DEFAULT_CADENCE, reminder_days_before: [7, 1], final_reminder_days_before: 1 };
    const due = dueMessages({
      now: at("2026-09-12T09:00:00Z"), // 1 day before
      service_starts_at: service,
      invite_sent: true,
      cadence,
    });
    expect(due.map((m) => m.purpose)).toEqual(["final_reminder"]);
  });

  it("falls back to the standard reminder when the final reminder was already sent on a shared window", () => {
    // Same shared window, but final_reminder already sent → the final guard fails
    // and the else-if path emits the still-unsent standard reminder instead.
    const cadence = { ...DEFAULT_CADENCE, reminder_days_before: [1], final_reminder_days_before: 1 };
    const due = dueMessages({
      now: at("2026-09-12T09:00:00Z"),
      service_starts_at: service,
      invite_sent: true,
      already_sent: ["final_reminder"],
      cadence,
    });
    expect(due.map((m) => m.purpose)).toEqual(["reminder"]);
  });
});
