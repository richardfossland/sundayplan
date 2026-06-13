/**
 * Server-side i18n. Resolves the active locale from the signed-in user's church
 * profile (cached per request), and `getT()` returns a bound `t(key, vars?)` for
 * server components. Client components use `useT()` from ./client.
 */
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_LOCALE, isLocale, translate, type Locale } from "./messages";

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

export const getLocale = cache(async (): Promise<Locale> => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return DEFAULT_LOCALE;
    const { data: member } = await supabase
      .from("church_member")
      .select("church_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!member?.church_id) return DEFAULT_LOCALE;
    const { data: church } = await supabase
      .from("church")
      .select("locale")
      .eq("id", member.church_id)
      .maybeSingle();
    const loc = church?.locale as string | undefined;
    return isLocale(loc) ? loc : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
});

export async function getT(): Promise<TFn> {
  const locale = await getLocale();
  return (key, vars) => translate(locale, key, vars);
}
