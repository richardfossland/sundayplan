/**
 * SERVER-ONLY booking comms (Phase 3). On a booking status transition we render
 * a booking template and transmit it through the SDK's channel/provider
 * abstraction, logging the result to public.sms_log / public.email_log.
 *
 * KEYLESS FALLBACK: `createProvider` (packages/sdk) returns the StubProvider
 * whenever Twilio/Resend env keys are absent — it records the send and returns
 * success WITHOUT any network call. So the build/tests/fresh-dev path needs no
 * secrets and nothing crashes; going live is pasting keys, not changing code.
 * `commsConfigured()` reports whether real providers are wired so callers/UX can
 * FLAG that real delivery needs keys.
 *
 * Channel is derived from the renter's contact string (an "@" → email, else
 * SMS). Recipients with no usable contact are skipped (logged as failed).
 */
import { createProvider, hasRealProvider } from "@sundayplan/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  renderBookingMessage,
  type BookingTemplateKey,
  type BookingTemplateValues,
} from "@/lib/booking-templates";
import { appBaseUrl, buildStatusLink, mintBookingStatusToken, hasMagicLinkSecret } from "@/lib/booking-link";
import type { Booking } from "@/src/types/booking";

type Channel = "sms" | "email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** sms | email from a free-form contact string; null if unusable. */
export function channelForContact(contact: string | null | undefined): Channel | null {
  if (!contact) return null;
  const t = contact.trim();
  if (!t) return null;
  if (EMAIL_RE.test(t)) return "email";
  // crude phone check: at least 6 digits after stripping punctuation
  if ((t.replace(/\D/g, "").length ?? 0) >= 6) return "sms";
  return null;
}

/** True when a real (non-stub) provider is configured for the channel. */
export function commsConfigured(env: NodeJS.ProcessEnv = process.env): {
  sms: boolean;
  email: boolean;
} {
  const e = env as Record<string, string | undefined>;
  return { sms: hasRealProvider("sms", e), email: hasRealProvider("email", e) };
}

async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function fmtDateTime(iso: string, locale: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  // Norwegian dd.mm.yyyy / HH:MM, English yyyy-mm-dd / HH:MM. UTC-stable.
  const date =
    locale === "no"
      ? `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`
      : `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return { date, time };
}

export interface BookingCommsResult {
  attempted: number;
  sent: number;
  skipped: number;
  /** True if any send used the keyless stub (real delivery needs keys). */
  usedStub: boolean;
}

/**
 * Render + send a booking template to the renter (and optionally a status link).
 * Logs to sms_log/email_log. No throw on send failure — failures are logged.
 */
export async function sendBookingComms(opts: {
  templateKey: BookingTemplateKey;
  booking: Pick<
    Booking,
    "id" | "church_id" | "title" | "starts_at_utc" | "renter_contact"
  >;
  churchName: string;
  facilityName: string;
  locale: string;
  /** Override the status-link recipient (defaults to the renter's link). */
  includeStatusLink?: boolean;
}): Promise<BookingCommsResult> {
  const { booking } = opts;
  const channel = channelForContact(booking.renter_contact);
  if (!channel) {
    return { attempted: 0, sent: 0, skipped: 1, usedStub: false };
  }

  // Mint a fresh status link (only if the secret is configured).
  let statusLink = "";
  if (opts.includeStatusLink !== false && hasMagicLinkSecret()) {
    const token = await mintBookingStatusToken(booking.id, booking.church_id);
    statusLink = buildStatusLink(appBaseUrl(), token);
  }

  const { date, time } = fmtDateTime(booking.starts_at_utc, opts.locale);
  const values: BookingTemplateValues = {
    facility_name: opts.facilityName,
    booking_date: date,
    booking_time: time,
    church_name: opts.churchName,
    status_link: statusLink,
  };
  const rendered = renderBookingMessage(opts.templateKey, opts.locale, values);

  const provider = createProvider(channel, process.env as Record<string, string | undefined>);
  const to = (booking.renter_contact ?? "").trim();
  const result = await provider.send({
    channel,
    to,
    subject: channel === "email" ? rendered.subject : null,
    body: rendered.body,
    reference: `booking:${booking.id}:${opts.templateKey}`,
  });

  await logDelivery({
    channel,
    churchId: booking.church_id,
    to,
    subject: rendered.subject,
    body: rendered.body,
    provider: result.provider,
    providerMessageId: result.provider_message_id ?? null,
    costCents: result.cost_cents ?? null,
    status: result.outcome === "sent" ? "sent" : "failed",
    templateKey: opts.templateKey,
  });

  return {
    attempted: 1,
    sent: result.outcome === "sent" ? 1 : 0,
    skipped: 0,
    usedStub: result.provider === "stub",
  };
}

/**
 * Notify the church's planners that a new request needs approval. Planners are
 * church_members with role admin/planner whose linked member row has a contact.
 * Best-effort: skips planners with no contact; logs each send.
 */
export async function notifyPlannersOfRequest(opts: {
  booking: Pick<Booking, "id" | "church_id" | "title" | "starts_at_utc">;
  churchName: string;
  facilityName: string;
  locale: string;
}): Promise<BookingCommsResult> {
  const db = createAdminClient();
  // planner-level church_members → their auth user → their member contact.
  const { data: planners } = await db
    .from("church_member")
    .select("user_id, role")
    .eq("church_id", opts.booking.church_id)
    .in("role", ["admin", "planner"]);

  const userIds = (planners ?? [])
    .map((p) => (p as { user_id: string | null }).user_id)
    .filter((id): id is string => Boolean(id));
  if (userIds.length === 0) return { attempted: 0, sent: 0, skipped: 0, usedStub: false };

  const { data: members } = await db
    .from("member")
    .select("user_id, email, phone_e164")
    .eq("church_id", opts.booking.church_id)
    .in("user_id", userIds);

  const { date, time } = fmtDateTime(opts.booking.starts_at_utc, opts.locale);
  const subject =
    opts.locale === "no"
      ? `Ny bookingforespørsel — ${opts.facilityName}`
      : `New booking request — ${opts.facilityName}`;
  const body =
    opts.locale === "no"
      ? `Ny forespørsel om ${opts.facilityName} den ${date} kl. ${time} venter på godkjenning i SundayBooking.`
      : `A new request for ${opts.facilityName} on ${date} at ${time} is awaiting approval in SundayBooking.`;

  let attempted = 0;
  let sent = 0;
  let skipped = 0;
  let usedStub = false;
  for (const m of (members ?? []) as { email: string | null; phone_e164: string | null }[]) {
    const contact = m.email ?? m.phone_e164 ?? null;
    const channel = channelForContact(contact);
    if (!channel || !contact) {
      skipped++;
      continue;
    }
    attempted++;
    const provider = createProvider(channel, process.env as Record<string, string | undefined>);
    const result = await provider.send({
      channel,
      to: contact.trim(),
      subject: channel === "email" ? subject : null,
      body,
      reference: `booking:${opts.booking.id}:planner_notice`,
    });
    if (result.provider === "stub") usedStub = true;
    if (result.outcome === "sent") sent++;
    await logDelivery({
      channel,
      churchId: opts.booking.church_id,
      to: contact.trim(),
      subject,
      body,
      provider: result.provider,
      providerMessageId: result.provider_message_id ?? null,
      costCents: result.cost_cents ?? null,
      status: result.outcome === "sent" ? "sent" : "failed",
      templateKey: "planner_notice",
    });
  }
  return { attempted, sent, skipped, usedStub };
}

/**
 * Persist a delivery to the per-channel log table. sms_log stores a body_hash
 * (GDPR — never plaintext); email_log stores the subject only. Failures here
 * are swallowed (logging must never break a transition) but surfaced to stderr.
 */
async function logDelivery(d: {
  channel: Channel;
  churchId: string;
  to: string;
  subject: string;
  body: string;
  provider: string;
  providerMessageId: string | null;
  costCents: number | null;
  status: "sent" | "failed";
  templateKey: string;
}): Promise<void> {
  const db = createAdminClient();
  const logStatus = d.status === "sent" ? "sent" : "failed";
  try {
    if (d.channel === "sms") {
      await db.from("sms_log").insert({
        church_id: d.churchId,
        member_id: null, // external renter — no member row
        provider: d.provider,
        template_id: d.templateKey,
        to_recipient: d.to,
        body_hash: await sha256Hex(d.body),
        status: logStatus,
        cost_cents: d.costCents,
        provider_message_id: d.providerMessageId,
        sent_at: d.status === "sent" ? new Date().toISOString() : null,
      });
    } else {
      await db.from("email_log").insert({
        church_id: d.churchId,
        member_id: null,
        provider: d.provider,
        template_id: d.templateKey,
        to_recipient: d.to,
        subject: d.subject,
        status: logStatus,
        provider_message_id: d.providerMessageId,
        sent_at: d.status === "sent" ? new Date().toISOString() : null,
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[booking:comms] failed to log delivery", err);
  }
}
