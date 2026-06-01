/**
 * Server-side i18n. `getLocale()` resolves the active locale from the church
 * profile (cached per request so repeated calls don't re-query), and `getT()`
 * returns a bound `t(key, vars?)` for server components. Client components use
 * `useT()` from ./client instead.
 */
import { cache } from "react";
import { getChurchProfile } from "@/lib/data/settings";
import { DEFAULT_LOCALE, isLocale, translate, type Locale } from "./messages";

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

export const getLocale = cache(async (): Promise<Locale> => {
  try {
    const profile = await getChurchProfile();
    const loc = profile?.locale;
    return isLocale(loc) ? loc : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
});

export async function getT(): Promise<TFn> {
  const locale = await getLocale();
  return (key, vars) => translate(locale, key, vars);
}
