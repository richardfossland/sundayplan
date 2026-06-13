"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { I18nProvider, useT } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/messages";

/**
 * Client app shell: brand header + top nav, wrapping the page in the locale
 * provider so client components can call useT(). The active locale is resolved
 * server-side and passed in.
 */
export function AppShell({
  locale,
  isPlanner,
  children,
}: {
  locale: Locale;
  isPlanner: boolean;
  children: ReactNode;
}) {
  return (
    <I18nProvider locale={locale}>
      <div className="min-h-screen">
        <Nav isPlanner={isPlanner} />
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </div>
    </I18nProvider>
  );
}

function Nav({ isPlanner }: { isPlanner: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const links: { href: string; label: string; plannerOnly?: boolean }[] = [
    { href: "/calendar", label: t("nav.calendar") },
    { href: "/request", label: t("nav.request") },
    { href: "/resources", label: t("nav.resources"), plannerOnly: true },
    { href: "/queue", label: t("nav.queue"), plannerOnly: true },
  ];

  return (
    <header className="border-b border-white/[0.07] bg-ink-950/60 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
        <Link href="/calendar" className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-royal-500 to-royal-700 text-sm font-bold text-gold-300">
            S
          </div>
          <span className="text-base font-semibold tracking-tight text-ink-100">
            Sunday<span className="text-gold-400">Booking</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          {links
            .filter((l) => !l.plannerOnly || isPlanner)
            .map((l) => {
              const active = pathname === l.href || pathname.startsWith(l.href + "/");
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition " +
                    (active
                      ? "bg-white/[0.08] text-ink-50"
                      : "text-ink-400 hover:bg-white/[0.05] hover:text-ink-200")
                  }
                >
                  {l.label}
                </Link>
              );
            })}
        </nav>
      </div>
    </header>
  );
}
