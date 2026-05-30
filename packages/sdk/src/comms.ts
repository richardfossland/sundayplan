/**
 * Communications engine — deterministic, pure functions (Phase 6).
 *
 * This is the testable core of the comms layer, mirroring how the scoring +
 * auto-fill engines are structured: no DB, no network, no clock except what the
 * caller passes in. The web/mobile data layers feed it plain data and the
 * provider layer (see `channels.ts`) does the actual transmission.
 *
 * It does four things:
 *   1. `renderTemplate`   — interpolate `{{variables}}` into a template body,
 *                           reporting missing + unknown variables.
 *   2. `formatFor*`       — per-channel formatting: SMS segmentation, email
 *                           subject+body, push title+body.
 *   3. `resolveRecipients`— turn a service's assignments + people into the list
 *                           of (person, channel, rendered message) to send,
 *                           skipping anyone with no usable channel.
 *   4. `dueMessages`      — given a "now" and a service date, decide which
 *                           messages (invite / reminder / final) are due, from a
 *                           cadence config. Deterministic, fully unit-tested.
 *
 * Phase 7 (magic-link volunteer response) plugs in by supplying the
 * `accept_link` / `decline_link` template variables per recipient — the
 * renderer + resolver already thread them through; nothing else changes here.
 */

import type {
  ContactChannel,
  MessageChannel,
  MessagePurpose,
  TemplateVariable,
} from "@sundayplan/shared";

// ── 1. Template rendering ─────────────────────────────────────────────────────

/** The set of variables a template is allowed to interpolate. */
export const KNOWN_TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  "volunteer_name",
  "role_name",
  "team_name",
  "service_title",
  "service_date",
  "service_time",
  "church_name",
  "accept_link",
  "decline_link",
] as const;

export type TemplateValues = Partial<Record<TemplateVariable, string>>;

export interface RenderResult {
  /** The body with every `{{var}}` replaced (unknown/missing left blank). */
  text: string;
  /** Known variables referenced by the template but absent from `values`. */
  missing: TemplateVariable[];
  /** Tokens referenced by the template that aren't in the known set. */
  unknown: string[];
  /** Known variables that were actually substituted. */
  used: TemplateVariable[];
}

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

const KNOWN_SET = new Set<string>(KNOWN_TEMPLATE_VARIABLES);

/**
 * Render `{{var}}` placeholders. Whitespace inside the braces is tolerated.
 * Unknown tokens are stripped (replaced with empty string) and reported;
 * known-but-unprovided variables are likewise blanked and reported as missing,
 * so the caller can warn the planner before sending half-blank messages.
 */
export function renderTemplate(body: string, values: TemplateValues): RenderResult {
  const missing = new Set<TemplateVariable>();
  const unknown = new Set<string>();
  const used = new Set<TemplateVariable>();

  const text = body.replace(TOKEN_RE, (_match, rawName: string) => {
    const name = rawName.trim();
    if (!KNOWN_SET.has(name)) {
      unknown.add(name);
      return "";
    }
    const key = name as TemplateVariable;
    const value = values[key];
    if (value === undefined || value === null || value === "") {
      missing.add(key);
      return "";
    }
    used.add(key);
    return value;
  });

  return {
    text,
    missing: [...missing],
    unknown: [...unknown],
    used: [...used],
  };
}

/** List the known + unknown variables a raw template body references. */
export function extractVariables(body: string): { known: TemplateVariable[]; unknown: string[] } {
  const known = new Set<TemplateVariable>();
  const unknown = new Set<string>();
  for (const m of body.matchAll(TOKEN_RE)) {
    const name = m[1].trim();
    if (KNOWN_SET.has(name)) known.add(name as TemplateVariable);
    else unknown.add(name);
  }
  return { known: [...known], unknown: [...unknown] };
}

// ── 2. Per-channel formatting ─────────────────────────────────────────────────

/**
 * GSM 03.38 7-bit default alphabet. Characters outside it force a UCS-2
 * (16-bit) encoding, which shrinks the per-segment budget. We don't need the
 * exact glyph table — counting whether every char is GSM-7 representable is
 * enough to pick the segment size, which is what matters for cost estimation.
 */
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** These count as two GSM-7 characters (escape + char). */
const GSM7_EXTENDED = "^{}\\[~]|€";

const GSM7_SET = new Set([...GSM7_BASIC]);
const GSM7_EXT_SET = new Set([...GSM7_EXTENDED]);

export interface SmsFormat {
  body: string;
  encoding: "GSM-7" | "UCS-2";
  /** Billable character count (extended GSM-7 chars count as 2). */
  characters: number;
  /** Number of concatenated SMS segments this body costs. */
  segments: number;
}

/**
 * Measure an SMS body: detect encoding, count billable characters, and compute
 * how many concatenated segments it needs. Single-segment budgets are 160
 * (GSM-7) / 70 (UCS-2); concatenated messages reserve a UDH header, dropping
 * the budget to 153 / 67 per segment — the industry-standard math.
 */
export function formatSms(body: string): SmsFormat {
  let isGsm7 = true;
  let characters = 0;
  for (const ch of body) {
    if (GSM7_SET.has(ch)) {
      characters += 1;
    } else if (GSM7_EXT_SET.has(ch)) {
      characters += 2;
    } else {
      isGsm7 = false;
      characters += 1;
    }
  }

  const encoding = isGsm7 ? "GSM-7" : "UCS-2";
  const single = isGsm7 ? 160 : 70;
  const concat = isGsm7 ? 153 : 67;
  const segments =
    characters === 0 ? 1 : characters <= single ? 1 : Math.ceil(characters / concat);

  return { body, encoding, characters, segments };
}

export interface EmailFormat {
  subject: string;
  body: string;
}

/** Format an email payload. A subject is required; we fall back to a default. */
export function formatEmail(
  subject: string | null | undefined,
  body: string,
  fallbackSubject = "A message from your church",
): EmailFormat {
  const trimmed = (subject ?? "").trim();
  return { subject: trimmed === "" ? fallbackSubject : trimmed, body };
}

export interface PushFormat {
  title: string;
  body: string;
}

/**
 * Format a push notification. `title` doubles as the email-style subject in the
 * template model; pushes truncate aggressively for the notification shade.
 */
export function formatPush(
  title: string | null | undefined,
  body: string,
  opts: { titleMax?: number; bodyMax?: number } = {},
): PushFormat {
  const titleMax = opts.titleMax ?? 50;
  const bodyMax = opts.bodyMax ?? 178;
  return {
    title: truncate((title ?? "").trim() || "SundayPlan", titleMax),
    body: truncate(body, bodyMax),
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return `${s.slice(0, max - 1)}…`;
}

// ── 3. Recipient resolution ───────────────────────────────────────────────────

export interface ResolvableMember {
  member_id: string;
  display_name: string;
  phone_e164: string | null;
  email: string | null;
  /** Whether this member has a registered push token (Phase 8). */
  has_push_token?: boolean;
  /** The member's preferred channel; we honour it when usable. */
  preferred_channel: ContactChannel;
}

/** Per-recipient template values, keyed by member id. */
export type PerRecipientValues = Record<string, TemplateValues>;

export type SkipReason =
  | "no_phone"
  | "no_email"
  | "no_push_token"
  | "no_usable_channel";

export interface ResolvedRecipient {
  member_id: string;
  display_name: string;
  channel: MessageChannel;
  /** Normalized destination — phone number or email. */
  to_recipient: string;
  /** Rendered, channel-formatted payload. */
  rendered: SmsFormat | EmailFormat | PushFormat;
  /** Variables referenced by the template but missing for this recipient. */
  missing: TemplateVariable[];
}

export interface SkippedRecipient {
  member_id: string;
  display_name: string;
  reason: SkipReason;
}

export interface ResolveResult {
  recipients: ResolvedRecipient[];
  skipped: SkippedRecipient[];
}

export interface ResolveOptions {
  /**
   * Channel the planner wants to use. `"preferred"` (default) uses each
   * member's `preferred_channel`, falling back to any usable channel; an
   * explicit channel forces that one and skips members who can't receive it.
   */
  channel?: MessageChannel | "preferred";
  /** Email subject (used when the resolved channel is email/push). */
  subject?: string | null;
  /** Fallback order when a preferred channel is unusable. */
  fallbackOrder?: MessageChannel[];
}

const DEFAULT_FALLBACK: MessageChannel[] = ["sms", "email", "push"];

function canUse(member: ResolvableMember, channel: MessageChannel): boolean {
  switch (channel) {
    case "sms":
      return !!member.phone_e164;
    case "email":
      return !!member.email;
    case "push":
      return !!member.has_push_token;
  }
}

function destinationFor(member: ResolvableMember, channel: MessageChannel): string {
  switch (channel) {
    case "sms":
      return member.phone_e164 ?? "";
    case "email":
      return member.email ?? "";
    case "push":
      return `push:${member.member_id}`;
  }
}

function skipReasonFor(channel: MessageChannel): SkipReason {
  switch (channel) {
    case "sms":
      return "no_phone";
    case "email":
      return "no_email";
    case "push":
      return "no_push_token";
  }
}

/**
 * Resolve a message + a set of members into the concrete list of sends. Each
 * member is rendered with their own template values (so per-recipient
 * accept/decline links work) and skipped with a reason if no channel is usable.
 */
export function resolveRecipients(
  body: string,
  members: ResolvableMember[],
  values: PerRecipientValues,
  opts: ResolveOptions = {},
): ResolveResult {
  const want = opts.channel ?? "preferred";
  const fallbackOrder = opts.fallbackOrder ?? DEFAULT_FALLBACK;
  const recipients: ResolvedRecipient[] = [];
  const skipped: SkippedRecipient[] = [];

  for (const member of members) {
    const channel = pickChannel(member, want, fallbackOrder);
    if (channel === null) {
      skipped.push({
        member_id: member.member_id,
        display_name: member.display_name,
        reason: want === "preferred" ? "no_usable_channel" : skipReasonFor(want),
      });
      continue;
    }

    const render = renderTemplate(body, values[member.member_id] ?? {});
    const rendered = formatForChannel(channel, opts.subject, render.text);
    recipients.push({
      member_id: member.member_id,
      display_name: member.display_name,
      channel,
      to_recipient: destinationFor(member, channel),
      rendered,
      missing: render.missing,
    });
  }

  return { recipients, skipped };
}

function pickChannel(
  member: ResolvableMember,
  want: MessageChannel | "preferred",
  fallbackOrder: MessageChannel[],
): MessageChannel | null {
  if (want !== "preferred") {
    return canUse(member, want) ? want : null;
  }
  if (canUse(member, member.preferred_channel)) return member.preferred_channel;
  for (const ch of fallbackOrder) {
    if (canUse(member, ch)) return ch;
  }
  return null;
}

/** Format already-rendered text for the given channel. */
export function formatForChannel(
  channel: MessageChannel,
  subject: string | null | undefined,
  text: string,
): SmsFormat | EmailFormat | PushFormat {
  switch (channel) {
    case "sms":
      return formatSms(text);
    case "email":
      return formatEmail(subject, text);
    case "push":
      return formatPush(subject, text);
  }
}

// ── 4. Reminder cadence / scheduling ──────────────────────────────────────────

/**
 * When to send each kind of message relative to the service date. Mirrors the
 * `reminder_cadence` JSONB on `church_settings`. `invite_immediately` sends the
 * first invite as soon as the planner publishes; the reminder windows are days
 * before the service.
 */
export interface CadenceConfig {
  invite_immediately: boolean;
  /** Days before the service to send a standard reminder. */
  reminder_days_before: number[];
  /** Days before the service for the final nudge (e.g. day-before). */
  final_reminder_days_before: number;
}

export const DEFAULT_CADENCE: CadenceConfig = {
  invite_immediately: true,
  reminder_days_before: [7],
  final_reminder_days_before: 1,
};

export interface DueMessage {
  purpose: Extract<MessagePurpose, "invite" | "reminder" | "final_reminder">;
  /** Whole days from `now` to the service (0 = service is today). */
  days_until_service: number;
}

export interface DueMessagesInput {
  now: Date;
  service_starts_at: Date;
  cadence?: CadenceConfig;
  /** Has the initial invite already gone out? Suppresses a duplicate invite. */
  invite_sent?: boolean;
  /** Purposes already sent (so a reminder isn't re-queued the same window). */
  already_sent?: MessagePurpose[];
}

const MS_PER_DAY = 86_400_000;

/** Whole calendar-ish days between two instants (floored, UTC-consistent). */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Decide which messages are due to send right now for a single service.
 * Deterministic: same (now, service date, cadence, state) → same result.
 *
 * Rules:
 *  - invite: due immediately if cadence says so and it hasn't been sent.
 *  - reminder: due when today is exactly one of the `reminder_days_before`
 *    windows (and the service is still in the future).
 *  - final_reminder: due when today is the `final_reminder_days_before` window.
 * The day-before window takes precedence: if a day is both a reminder window and
 * the final window, only the final reminder is emitted to avoid double-texting.
 */
export function dueMessages(input: DueMessagesInput): DueMessage[] {
  const cadence = input.cadence ?? DEFAULT_CADENCE;
  const sent = new Set(input.already_sent ?? []);
  const daysUntil = daysBetween(input.now, input.service_starts_at);
  const out: DueMessage[] = [];

  // Don't send anything once the service is in the past.
  if (daysUntil < 0) return out;

  if (cadence.invite_immediately && !input.invite_sent && !sent.has("invite")) {
    out.push({ purpose: "invite", days_until_service: daysUntil });
  }

  const isFinalWindow = daysUntil === cadence.final_reminder_days_before;
  if (isFinalWindow && !sent.has("final_reminder")) {
    out.push({ purpose: "final_reminder", days_until_service: daysUntil });
  } else if (
    cadence.reminder_days_before.includes(daysUntil) &&
    !sent.has("reminder")
  ) {
    out.push({ purpose: "reminder", days_until_service: daysUntil });
  }

  return out;
}
