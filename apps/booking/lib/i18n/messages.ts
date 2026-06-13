/**
 * Message catalogs — dependency-free i18n, Norwegian-first with English as the
 * structural source + fallback. Mirrors apps/web's pattern; Phase 0 ships only
 * the keys this app needs (no/en). Add locales by mirroring en.ts key-for-key.
 *
 * Keys are flat dotted strings; `{var}` placeholders are interpolated by
 * `translate()`.
 */
import en from "./catalogs/en";
import no from "./catalogs/no";

export const LOCALES = ["no", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "no";

export function isLocale(v: string | null | undefined): v is Locale {
  return (LOCALES as readonly string[]).includes(v ?? "");
}

type Catalog = Record<string, string>;

export const CATALOGS: Record<Locale, Catalog> = { no, en };

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
