import type { ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n/client";
import { getRequestLocale } from "@/lib/i18n/request-locale";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  // Pre-auth: no church profile yet, so the browser's Accept-Language picks
  // the locale (a German church sees German before they even have an account).
  const locale = await getRequestLocale();
  return (
    <I18nProvider locale={locale}>
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-royal-500 to-royal-700 text-base font-bold text-gold-300">
              S
            </div>
            <span className="text-lg font-semibold tracking-tight text-ink-100">
              Sunday<span className="text-gold-400">Plan</span>
            </span>
          </div>
          {children}
        </div>
      </div>
    </I18nProvider>
  );
}
