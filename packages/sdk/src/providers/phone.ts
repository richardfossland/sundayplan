/**
 * Phone-number normalization + SMS segment math shared by SMS providers.
 *
 * Pure, dependency-free. Normalization is deliberately conservative: we only
 * guess a country for bare national numbers when a default country is
 * configured (churches are single-country tenants); anything else must arrive
 * in international form. A wrong guess sends a volunteer's rota SMS to a
 * stranger — failing loudly is the better error.
 */

/** Countries we can prefix bare national numbers for. */
const COUNTRY_PREFIX: Record<string, { cc: string; nationalLength: number[] }> = {
  NO: { cc: "+47", nationalLength: [8] },
  SE: { cc: "+46", nationalLength: [9] },
  DK: { cc: "+45", nationalLength: [8] },
  DE: { cc: "+49", nationalLength: [10, 11] },
  FR: { cc: "+33", nationalLength: [9] },
  PL: { cc: "+48", nationalLength: [9] },
  GB: { cc: "+44", nationalLength: [10] },
  US: { cc: "+1", nationalLength: [10] },
};

/**
 * Normalize a raw phone number to E.164 (`+<digits>`), or `null` when it can't
 * be done safely. Accepts `+…`, `00…`, and — when `defaultCountry` is set — a
 * bare national number of the expected length (leading `0` trunk digit
 * stripped for countries that use one).
 */
export function toE164(raw: string, defaultCountry = "NO"): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Strip visual separators people actually type.
  let s = trimmed.replace(/[\s().\- ]/g, "");

  if (s.startsWith("00")) s = `+${s.slice(2)}`;

  if (s.startsWith("+")) {
    const digits = s.slice(1);
    if (!/^\d{7,15}$/.test(digits)) return null;
    return `+${digits}`;
  }

  if (!/^\d+$/.test(s)) return null;

  const country = COUNTRY_PREFIX[defaultCountry.toUpperCase()];
  if (!country) return null;

  // Trunk `0` (used by SE/DE/FR/PL/GB national formats) is dropped before the
  // country code; NO/DK don't use one, so a leading 0 there is just invalid.
  const usesTrunkZero = !["NO", "DK", "US"].includes(defaultCountry.toUpperCase());
  const national = usesTrunkZero && s.startsWith("0") ? s.slice(1) : s;

  if (!country.nationalLength.includes(national.length)) return null;
  return `${country.cc}${national}`;
}

/**
 * The GSM 03.38 basic character set (+ extension chars, which cost 2 septets).
 * A message confined to this set packs 160 chars into one segment (153 per
 * segment when concatenated); anything else forces UCS-2 (70 / 67).
 */
// prettier-ignore
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM_EXTENSION = new Set("^{}\\[~]|€");

/** Number of SMS segments a body will occupy, GSM-7 vs UCS-2 aware. */
export function smsSegments(body: string): number {
  if (body.length === 0) return 1;

  let gsm = true;
  let septets = 0;
  for (const ch of body) {
    if (GSM_BASIC.has(ch)) septets += 1;
    else if (GSM_EXTENSION.has(ch)) septets += 2;
    else {
      gsm = false;
      break;
    }
  }

  if (gsm) {
    return septets <= 160 ? 1 : Math.ceil(septets / 153);
  }
  // UCS-2: count UTF-16 code units (that's what the wire format uses).
  const units = body.length;
  return units <= 70 ? 1 : Math.ceil(units / 67);
}

/**
 * Estimated send cost in cents given a per-segment price (from env, e.g.
 * `SMS_COST_CENTS_PER_SEGMENT`). Undefined price → undefined estimate, so the
 * delivery row stays honest rather than recording a made-up 0.
 */
export function estimateSmsCostCents(
  body: string,
  centsPerSegment: number | undefined,
): number | undefined {
  if (centsPerSegment === undefined || Number.isNaN(centsPerSegment)) return undefined;
  return smsSegments(body) * centsPerSegment;
}
