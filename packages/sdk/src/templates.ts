/**
 * Phase 6 — localized assignment-message templates (pure builders).
 *
 * The comms engine in `comms.ts` renders + resolves arbitrary planner-authored
 * templates. This module supplies the *built-in* default templates for the
 * three transactional assignment messages — INVITE, REMINDER, CONFIRMATION —
 * localized for the seven Sunday-suite locales (no, en, sv, da, de, fr, pl),
 * for both SMS and email.
 *
 * Pure + deterministic: no sending, no clock, no I/O. A builder takes the
 * recipient/service facts, picks the locale (falling back to `en` for any
 * locale we don't have), interpolates them via the shared {@link renderTemplate}
 * `{{variable}}` mechanism, and returns the ready-to-format text. The provider
 * layer (channels.ts) does the actual transmission.
 */

import type { MessageChannel, TemplateVariable } from "@sundayplan/shared";
import { renderTemplate, type TemplateValues } from "./comms";

/** The three transactional assignment-message purposes this module covers. */
export type AssignmentMessagePurpose = "invite" | "reminder" | "confirmation";

/** The Sunday-suite launch locales. `en` is the canonical fallback. */
export const SUITE_LOCALES = ["no", "en", "sv", "da", "de", "fr", "pl"] as const;
export type SuiteLocale = (typeof SUITE_LOCALES)[number];

/** Default locale used whenever a requested locale isn't in {@link SUITE_LOCALES}. */
export const FALLBACK_LOCALE: SuiteLocale = "en";

/** Facts about a single assignment, fed to the builders. */
export interface AssignmentFacts {
  /** Volunteer display name. */
  memberName: string;
  /** Role/position they're assigned to (e.g. "Drums", "Welcome team"). */
  roleName: string;
  /** Service title (e.g. "Sunday Morning"). */
  serviceName: string;
  /** Human-readable service date, already localized by the caller (e.g. "13. sep"). */
  serviceDate: string;
  /**
   * Magic-link URL the volunteer taps to respond. The caller mints it
   * per-recipient (Phase 7). Defaults to a placeholder so previews render.
   */
  magicLinkUrl?: string;
}

/** Placeholder URL used when the caller hasn't minted a real magic link yet. */
export const MAGIC_LINK_PLACEHOLDER = "{{accept_link}}";

interface TemplateStrings {
  /** Email subject. SMS ignores it. */
  subject: string;
  /** SMS body. */
  sms: string;
  /** Email body (plain text). */
  email: string;
}

/**
 * Built-in template bodies per locale → purpose → strings. Bodies use the same
 * `{{variable}}` tokens as planner-authored templates so they flow through the
 * existing renderer/resolver unchanged.
 */
const TEMPLATES: Record<SuiteLocale, Record<AssignmentMessagePurpose, TemplateStrings>> = {
  en: {
    invite: {
      subject: "You're invited to serve: {{service_title}}",
      sms: "Hi {{volunteer_name}}! You're invited to serve as {{role_name}} at {{service_title}} on {{service_date}}. Tap to respond: {{accept_link}}",
      email:
        "Hi {{volunteer_name}},\n\nYou're invited to serve as {{role_name}} at {{service_title}} on {{service_date}}.\n\nPlease let us know if you can make it:\n{{accept_link}}\n\nThank you!",
    },
    reminder: {
      subject: "Reminder: {{service_title}} on {{service_date}}",
      sms: "Hi {{volunteer_name}}, a reminder that you're serving as {{role_name}} at {{service_title}} on {{service_date}}. Details: {{accept_link}}",
      email:
        "Hi {{volunteer_name}},\n\nJust a reminder that you're serving as {{role_name}} at {{service_title}} on {{service_date}}.\n\nSee the details here:\n{{accept_link}}\n\nThank you!",
    },
    confirmation: {
      subject: "Confirmed: {{service_title}} on {{service_date}}",
      sms: "Thanks {{volunteer_name}}! You're confirmed as {{role_name}} at {{service_title}} on {{service_date}}. See you there!",
      email:
        "Hi {{volunteer_name}},\n\nYou're confirmed as {{role_name}} at {{service_title}} on {{service_date}}. Thank you for serving — see you there!\n\nManage your assignment:\n{{accept_link}}",
    },
  },
  no: {
    invite: {
      subject: "Du er invitert til å tjene: {{service_title}}",
      sms: "Hei {{volunteer_name}}! Du er invitert til å tjene som {{role_name}} på {{service_title}} den {{service_date}}. Trykk for å svare: {{accept_link}}",
      email:
        "Hei {{volunteer_name}},\n\nDu er invitert til å tjene som {{role_name}} på {{service_title}} den {{service_date}}.\n\nGi oss beskjed om du kan stille:\n{{accept_link}}\n\nTusen takk!",
    },
    reminder: {
      subject: "Påminnelse: {{service_title}} den {{service_date}}",
      sms: "Hei {{volunteer_name}}, en påminnelse om at du tjener som {{role_name}} på {{service_title}} den {{service_date}}. Detaljer: {{accept_link}}",
      email:
        "Hei {{volunteer_name}},\n\nBare en påminnelse om at du tjener som {{role_name}} på {{service_title}} den {{service_date}}.\n\nSe detaljene her:\n{{accept_link}}\n\nTusen takk!",
    },
    confirmation: {
      subject: "Bekreftet: {{service_title}} den {{service_date}}",
      sms: "Takk {{volunteer_name}}! Du er bekreftet som {{role_name}} på {{service_title}} den {{service_date}}. Vi sees!",
      email:
        "Hei {{volunteer_name}},\n\nDu er bekreftet som {{role_name}} på {{service_title}} den {{service_date}}. Takk for at du tjener — vi sees!\n\nAdministrer oppgaven din:\n{{accept_link}}",
    },
  },
  sv: {
    invite: {
      subject: "Du är inbjuden att tjäna: {{service_title}}",
      sms: "Hej {{volunteer_name}}! Du är inbjuden att tjäna som {{role_name}} vid {{service_title}} den {{service_date}}. Tryck för att svara: {{accept_link}}",
      email:
        "Hej {{volunteer_name}},\n\nDu är inbjuden att tjäna som {{role_name}} vid {{service_title}} den {{service_date}}.\n\nMeddela oss om du kan komma:\n{{accept_link}}\n\nTack så mycket!",
    },
    reminder: {
      subject: "Påminnelse: {{service_title}} den {{service_date}}",
      sms: "Hej {{volunteer_name}}, en påminnelse om att du tjänar som {{role_name}} vid {{service_title}} den {{service_date}}. Detaljer: {{accept_link}}",
      email:
        "Hej {{volunteer_name}},\n\nEn påminnelse om att du tjänar som {{role_name}} vid {{service_title}} den {{service_date}}.\n\nSe detaljerna här:\n{{accept_link}}\n\nTack så mycket!",
    },
    confirmation: {
      subject: "Bekräftat: {{service_title}} den {{service_date}}",
      sms: "Tack {{volunteer_name}}! Du är bekräftad som {{role_name}} vid {{service_title}} den {{service_date}}. Vi ses!",
      email:
        "Hej {{volunteer_name}},\n\nDu är bekräftad som {{role_name}} vid {{service_title}} den {{service_date}}. Tack för att du tjänar — vi ses!\n\nHantera ditt uppdrag:\n{{accept_link}}",
    },
  },
  da: {
    invite: {
      subject: "Du er inviteret til at tjene: {{service_title}}",
      sms: "Hej {{volunteer_name}}! Du er inviteret til at tjene som {{role_name}} ved {{service_title}} den {{service_date}}. Tryk for at svare: {{accept_link}}",
      email:
        "Hej {{volunteer_name}},\n\nDu er inviteret til at tjene som {{role_name}} ved {{service_title}} den {{service_date}}.\n\nGiv os besked, om du kan deltage:\n{{accept_link}}\n\nMange tak!",
    },
    reminder: {
      subject: "Påmindelse: {{service_title}} den {{service_date}}",
      sms: "Hej {{volunteer_name}}, en påmindelse om at du tjener som {{role_name}} ved {{service_title}} den {{service_date}}. Detaljer: {{accept_link}}",
      email:
        "Hej {{volunteer_name}},\n\nEn påmindelse om at du tjener som {{role_name}} ved {{service_title}} den {{service_date}}.\n\nSe detaljerne her:\n{{accept_link}}\n\nMange tak!",
    },
    confirmation: {
      subject: "Bekræftet: {{service_title}} den {{service_date}}",
      sms: "Tak {{volunteer_name}}! Du er bekræftet som {{role_name}} ved {{service_title}} den {{service_date}}. Vi ses!",
      email:
        "Hej {{volunteer_name}},\n\nDu er bekræftet som {{role_name}} ved {{service_title}} den {{service_date}}. Tak fordi du tjener — vi ses!\n\nAdminister din opgave:\n{{accept_link}}",
    },
  },
  de: {
    invite: {
      subject: "Du bist eingeladen mitzuwirken: {{service_title}}",
      sms: "Hallo {{volunteer_name}}! Du bist eingeladen, als {{role_name}} bei {{service_title}} am {{service_date}} mitzuwirken. Zum Antworten tippen: {{accept_link}}",
      email:
        "Hallo {{volunteer_name}},\n\nDu bist eingeladen, als {{role_name}} bei {{service_title}} am {{service_date}} mitzuwirken.\n\nBitte sag uns Bescheid, ob du kommen kannst:\n{{accept_link}}\n\nVielen Dank!",
    },
    reminder: {
      subject: "Erinnerung: {{service_title}} am {{service_date}}",
      sms: "Hallo {{volunteer_name}}, eine Erinnerung: Du wirkst als {{role_name}} bei {{service_title}} am {{service_date}} mit. Details: {{accept_link}}",
      email:
        "Hallo {{volunteer_name}},\n\nNur eine Erinnerung: Du wirkst als {{role_name}} bei {{service_title}} am {{service_date}} mit.\n\nDetails hier:\n{{accept_link}}\n\nVielen Dank!",
    },
    confirmation: {
      subject: "Bestätigt: {{service_title}} am {{service_date}}",
      sms: "Danke {{volunteer_name}}! Du bist als {{role_name}} bei {{service_title}} am {{service_date}} bestätigt. Bis dann!",
      email:
        "Hallo {{volunteer_name}},\n\nDu bist als {{role_name}} bei {{service_title}} am {{service_date}} bestätigt. Danke fürs Mitwirken — bis dann!\n\nVerwalte deinen Einsatz:\n{{accept_link}}",
    },
  },
  fr: {
    invite: {
      subject: "Vous êtes invité(e) à servir : {{service_title}}",
      sms: "Bonjour {{volunteer_name}} ! Vous êtes invité(e) à servir comme {{role_name}} à {{service_title}} le {{service_date}}. Appuyez pour répondre : {{accept_link}}",
      email:
        "Bonjour {{volunteer_name}},\n\nVous êtes invité(e) à servir comme {{role_name}} à {{service_title}} le {{service_date}}.\n\nMerci de nous indiquer si vous êtes disponible :\n{{accept_link}}\n\nMerci beaucoup !",
    },
    reminder: {
      subject: "Rappel : {{service_title}} le {{service_date}}",
      sms: "Bonjour {{volunteer_name}}, un rappel : vous servez comme {{role_name}} à {{service_title}} le {{service_date}}. Détails : {{accept_link}}",
      email:
        "Bonjour {{volunteer_name}},\n\nUn petit rappel : vous servez comme {{role_name}} à {{service_title}} le {{service_date}}.\n\nVoir les détails ici :\n{{accept_link}}\n\nMerci beaucoup !",
    },
    confirmation: {
      subject: "Confirmé : {{service_title}} le {{service_date}}",
      sms: "Merci {{volunteer_name}} ! Vous êtes confirmé(e) comme {{role_name}} à {{service_title}} le {{service_date}}. À bientôt !",
      email:
        "Bonjour {{volunteer_name}},\n\nVous êtes confirmé(e) comme {{role_name}} à {{service_title}} le {{service_date}}. Merci de servir — à bientôt !\n\nGérez votre mission :\n{{accept_link}}",
    },
  },
  pl: {
    invite: {
      subject: "Zaproszenie do służby: {{service_title}}",
      sms: "Cześć {{volunteer_name}}! Zapraszamy do służby jako {{role_name}} na {{service_title}} dnia {{service_date}}. Dotknij, aby odpowiedzieć: {{accept_link}}",
      email:
        "Cześć {{volunteer_name}},\n\nZapraszamy Cię do służby jako {{role_name}} na {{service_title}} dnia {{service_date}}.\n\nDaj nam znać, czy możesz przyjść:\n{{accept_link}}\n\nDziękujemy!",
    },
    reminder: {
      subject: "Przypomnienie: {{service_title}} dnia {{service_date}}",
      sms: "Cześć {{volunteer_name}}, przypominamy, że służysz jako {{role_name}} na {{service_title}} dnia {{service_date}}. Szczegóły: {{accept_link}}",
      email:
        "Cześć {{volunteer_name}},\n\nPrzypominamy, że służysz jako {{role_name}} na {{service_title}} dnia {{service_date}}.\n\nZobacz szczegóły tutaj:\n{{accept_link}}\n\nDziękujemy!",
    },
    confirmation: {
      subject: "Potwierdzono: {{service_title}} dnia {{service_date}}",
      sms: "Dziękujemy {{volunteer_name}}! Potwierdzono Cię jako {{role_name}} na {{service_title}} dnia {{service_date}}. Do zobaczenia!",
      email:
        "Cześć {{volunteer_name}},\n\nPotwierdzono Cię jako {{role_name}} na {{service_title}} dnia {{service_date}}. Dziękujemy za służbę — do zobaczenia!\n\nZarządzaj swoim zadaniem:\n{{accept_link}}",
    },
  },
};

/** Normalize a requested locale to a supported one, falling back to `en`. */
export function resolveLocale(locale: string | null | undefined): SuiteLocale {
  if (locale == null) return FALLBACK_LOCALE;
  // Accept region-tagged locales like "nb-NO" / "en_US" by taking the base tag.
  const base = locale.toLowerCase().split(/[-_]/)[0];
  // Norwegian Bokmål/Nynorsk both map onto our "no" bundle.
  const normalized = base === "nb" || base === "nn" ? "no" : base;
  return (SUITE_LOCALES as readonly string[]).includes(normalized)
    ? (normalized as SuiteLocale)
    : FALLBACK_LOCALE;
}

/** Map {@link AssignmentFacts} onto the renderer's {@link TemplateValues}. */
function toValues(facts: AssignmentFacts): TemplateValues {
  const values: Partial<Record<TemplateVariable, string>> = {
    volunteer_name: facts.memberName,
    role_name: facts.roleName,
    service_title: facts.serviceName,
    service_date: facts.serviceDate,
  };
  // Only substitute the accept_link when the caller supplied a real URL.
  // Otherwise we deliberately leave the literal `{{accept_link}}` token in the
  // body (handled in `render` below) so the Phase-7 resolver can mint + fill it
  // per recipient. `renderTemplate` would blank a known-but-missing variable, so
  // we keep it out of `values` and re-protect the token before rendering.
  if (facts.magicLinkUrl != null && facts.magicLinkUrl !== "") {
    values.accept_link = facts.magicLinkUrl;
  }
  return values;
}

/**
 * Interpolate facts into a raw body. When no magic-link URL was supplied, the
 * `{{accept_link}}` token is preserved verbatim (not blanked) so a downstream
 * per-recipient resolver can fill it later.
 */
function render(raw: string, facts: AssignmentFacts): string {
  const values = toValues(facts);
  if (values.accept_link != null) {
    return renderTemplate(raw, values).text;
  }
  // Shield the link token, render the rest, then restore it.
  const SENTINEL = " ACCEPT_LINK ";
  const shielded = raw.replace(/\{\{\s*accept_link\s*\}\}/g, SENTINEL);
  const rendered = renderTemplate(shielded, values).text;
  return rendered.split(SENTINEL).join("{{accept_link}}");
}

export interface RenderedAssignmentMessage {
  locale: SuiteLocale;
  purpose: AssignmentMessagePurpose;
  channel: MessageChannel;
  /** Email subject (SMS leaves this null). */
  subject: string | null;
  /** Interpolated body text, ready for `formatForChannel`. */
  body: string;
}

/**
 * Build a localized, interpolated assignment message. Picks the locale (falling
 * back to `en`), interpolates the facts, and returns the subject (email only) +
 * body. SMS and email share the same locale bundle but different bodies.
 *
 * When `magicLinkUrl` is omitted, the body keeps the literal `{{accept_link}}`
 * placeholder — the resolver/Phase-7 layer fills it per recipient.
 */
export function buildAssignmentMessage(
  purpose: AssignmentMessagePurpose,
  channel: "sms" | "email",
  locale: string | null | undefined,
  facts: AssignmentFacts,
): RenderedAssignmentMessage {
  const resolved = resolveLocale(locale);
  const strings = TEMPLATES[resolved][purpose];
  const rawBody = channel === "sms" ? strings.sms : strings.email;
  const body = render(rawBody, facts);
  const subject = channel === "email" ? render(strings.subject, facts) : null;
  return { locale: resolved, purpose, channel, subject, body };
}

/** The raw (un-interpolated) template strings for a locale/purpose — for editing. */
export function assignmentTemplate(
  purpose: AssignmentMessagePurpose,
  locale: string | null | undefined,
): { subject: string; sms: string; email: string } {
  const resolved = resolveLocale(locale);
  return { ...TEMPLATES[resolved][purpose] };
}
