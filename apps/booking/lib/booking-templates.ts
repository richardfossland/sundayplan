/**
 * Booking comms templates — pure, network-free render layer (Phase 3).
 *
 * The SDK's `renderTemplate` (packages/sdk/src/comms.ts) owns the generic
 * volunteer-message variable set (volunteer_name, role_name, …). The booking
 * domain needs a DIFFERENT variable set ({{facility_name}}, {{booking_date}},
 * {{booking_time}}, {{church_name}}, {{status_link}}), so this module mirrors
 * the SDK renderer's contract for the booking variables rather than overloading
 * the shared one. Same {{var}} syntax + whitespace tolerance + missing/unknown
 * reporting, so behaviour is identical and unit-tested (booking-templates.test).
 *
 * Three transactional templates + one reminder, per channel-agnostic body
 * (SMS-first; email reuses the body as text). Norwegian-first with English.
 */

export type BookingTemplateKey =
  | "booking_requested"
  | "booking_approved"
  | "booking_declined"
  | "booking_reminder";

export const BOOKING_TEMPLATE_VARIABLES = [
  "facility_name",
  "booking_date",
  "booking_time",
  "church_name",
  "status_link",
] as const;

export type BookingTemplateVariable = (typeof BOOKING_TEMPLATE_VARIABLES)[number];
export type BookingTemplateValues = Partial<Record<BookingTemplateVariable, string>>;

const KNOWN = new Set<string>(BOOKING_TEMPLATE_VARIABLES);
const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export interface BookingRenderResult {
  text: string;
  missing: BookingTemplateVariable[];
  unknown: string[];
  used: BookingTemplateVariable[];
}

/** Interpolate {{var}} placeholders; unknown + missing are blanked + reported. */
export function renderBookingTemplate(
  body: string,
  values: BookingTemplateValues,
): BookingRenderResult {
  const missing = new Set<BookingTemplateVariable>();
  const unknown = new Set<string>();
  const used = new Set<BookingTemplateVariable>();

  const text = body.replace(TOKEN_RE, (_m, rawName: string) => {
    const name = rawName.trim();
    if (!KNOWN.has(name)) {
      unknown.add(name);
      return "";
    }
    const key = name as BookingTemplateVariable;
    const value = values[key];
    if (value === undefined || value === null || value === "") {
      missing.add(key);
      return "";
    }
    used.add(key);
    return value;
  });

  return { text, missing: [...missing], unknown: [...unknown], used: [...used] };
}

/** Built-in template bodies per locale (no/en). SMS-length-conscious. */
const TEMPLATES: Record<"no" | "en", Record<BookingTemplateKey, { subject: string; body: string }>> = {
  no: {
    booking_requested: {
      subject: "Forespørsel mottatt — {{facility_name}}",
      body:
        "Hei! Vi har mottatt din forespørsel om {{facility_name}} den {{booking_date}} kl. {{booking_time}}. " +
        "Den venter på godkjenning. Følg status her: {{status_link}}\n— {{church_name}}",
    },
    booking_approved: {
      subject: "Bekreftet — {{facility_name}}",
      body:
        "Din booking av {{facility_name}} den {{booking_date}} kl. {{booking_time}} er bekreftet. " +
        "Se detaljer: {{status_link}}\n— {{church_name}}",
    },
    booking_declined: {
      subject: "Avslått — {{facility_name}}",
      body:
        "Dessverre kunne vi ikke bekrefte din booking av {{facility_name}} den {{booking_date}} kl. {{booking_time}}. " +
        "Ta kontakt for alternativer: {{status_link}}\n— {{church_name}}",
    },
    booking_reminder: {
      subject: "Påminnelse — {{facility_name}}",
      body:
        "Påminnelse: din booking av {{facility_name}} er {{booking_date}} kl. {{booking_time}}. " +
        "Detaljer: {{status_link}}\n— {{church_name}}",
    },
  },
  en: {
    booking_requested: {
      subject: "Request received — {{facility_name}}",
      body:
        "Hi! We received your request for {{facility_name}} on {{booking_date}} at {{booking_time}}. " +
        "It is awaiting approval. Track its status here: {{status_link}}\n— {{church_name}}",
    },
    booking_approved: {
      subject: "Confirmed — {{facility_name}}",
      body:
        "Your booking of {{facility_name}} on {{booking_date}} at {{booking_time}} is confirmed. " +
        "See details: {{status_link}}\n— {{church_name}}",
    },
    booking_declined: {
      subject: "Declined — {{facility_name}}",
      body:
        "Unfortunately we could not confirm your booking of {{facility_name}} on {{booking_date}} at {{booking_time}}. " +
        "Get in touch for alternatives: {{status_link}}\n— {{church_name}}",
    },
    booking_reminder: {
      subject: "Reminder — {{facility_name}}",
      body:
        "Reminder: your booking of {{facility_name}} is on {{booking_date}} at {{booking_time}}. " +
        "Details: {{status_link}}\n— {{church_name}}",
    },
  },
};

/** The (subject, body) template for a key + locale, falling back to English. */
export function bookingTemplate(
  key: BookingTemplateKey,
  locale: string,
): { subject: string; body: string } {
  const loc = locale === "no" ? "no" : "en";
  return TEMPLATES[loc][key];
}

/** Convenience: render a built-in template to (subject, body) in one call. */
export function renderBookingMessage(
  key: BookingTemplateKey,
  locale: string,
  values: BookingTemplateValues,
): { subject: string; body: string; missing: BookingTemplateVariable[] } {
  const tpl = bookingTemplate(key, locale);
  const subject = renderBookingTemplate(tpl.subject, values);
  const body = renderBookingTemplate(tpl.body, values);
  return {
    subject: subject.text,
    body: body.text,
    missing: [...new Set([...subject.missing, ...body.missing])],
  };
}
