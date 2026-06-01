"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, translate, type Locale } from "./messages";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** Provides the active locale to client components. Mounted once in the shell. */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

export function useT(): TFn {
  const locale = useContext(LocaleContext);
  return useMemo<TFn>(() => (key, vars) => translate(locale, key, vars), [locale]);
}
