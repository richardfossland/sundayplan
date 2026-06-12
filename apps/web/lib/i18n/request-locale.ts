/**
 * Locale for PRE-AUTH surfaces (sign-in/up, church onboarding) where no church
 * profile exists yet: best-match the browser's Accept-Language against the
 * suite locales. Once a church exists, `getLocale()` (./server) wins — the
 * church profile is the product-level truth, this is just the front door.
 */
import { headers } from "next/headers";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./messages";

/** Parse an Accept-Language header into the best supported locale. */
export function matchAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((r) => r.tag && !Number.isNaN(r.q))
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    // "nb-NO"/"nn" are Norwegian; otherwise match on the primary subtag.
    const primary = tag.split("-")[0];
    const candidate = primary === "nb" || primary === "nn" ? "no" : primary;
    if (isLocale(candidate)) return candidate;
  }
  return DEFAULT_LOCALE;
}

/** The request's pre-auth locale (server components / layouts only). */
export async function getRequestLocale(): Promise<Locale> {
  const h = await headers();
  return matchAcceptLanguage(h.get("accept-language"));
}
