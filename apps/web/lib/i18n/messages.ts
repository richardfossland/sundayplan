/**
 * Message catalogs — dependency-free i18n for the Sunday suite. Norwegian-first
 * (the launch locale) with English as the structural source and fallback. New
 * keys land in `catalogs/en.ts` first; every other locale mirrors it key-for-key
 * (enforced by scripts/check-i18n.mjs in `npm run check`), and `translate()`
 * still falls back to English so the UI never shows a raw key mid-migration.
 *
 * Keys are flat dotted strings to keep lookup trivial in both server and client
 * components. `{var}` placeholders are interpolated by `translate()`.
 */
import en from "./catalogs/en";
import no from "./catalogs/no";
import sv from "./catalogs/sv";
import da from "./catalogs/da";
import de from "./catalogs/de";
import fr from "./catalogs/fr";
import pl from "./catalogs/pl";

export const LOCALES = ["no", "en", "sv", "da", "de", "fr", "pl"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "no";

export function isLocale(v: string | null | undefined): v is Locale {
  return (LOCALES as readonly string[]).includes(v ?? "");
}

type Catalog = Record<string, string>;

export const CATALOGS: Record<Locale, Catalog> = { no, en, sv, da, de, fr, pl };

/** Resolve a dotted key for `locale`, falling back to English, then the key. */
export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const raw = CATALOGS[locale]?.[key] ?? CATALOGS.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}
