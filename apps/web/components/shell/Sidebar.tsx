"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";

// Grouped navigation. PC-style top dropdowns are exactly what users complain
// loses them ("not clear where to find things"), so we keep a flat left rail
// but label it by intent — Plan / People / Engage — for instant orientation.
const SECTIONS: { heading: string | null; items: { href: string; key: string }[] }[] = [
  { heading: null, items: [{ href: "/", key: "nav.dashboard" }] },
  {
    heading: "nav.section.plan",
    items: [
      { href: "/services", key: "nav.services" },
      { href: "/schedule", key: "nav.schedule" },
      { href: "/songs", key: "nav.songs" },
    ],
  },
  {
    heading: "nav.section.people",
    items: [
      { href: "/people", key: "nav.people" },
      { href: "/teams", key: "nav.teams" },
    ],
  },
  {
    heading: "nav.section.engage",
    items: [
      { href: "/messages", key: "nav.messages" },
      { href: "/reports", key: "nav.reports" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        "group relative flex items-center rounded-lg px-3 py-2 text-sm transition-colors " +
        (active ? "bg-white/[0.06] text-ink-50" : "text-ink-400 hover:bg-white/[0.04] hover:text-ink-200")
      }
    >
      <span
        className={
          "absolute left-0 h-4 w-0.5 rounded-full bg-gold-400 transition-opacity " +
          (active ? "opacity-100" : "opacity-0")
        }
      />
      {label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav className="flex h-full flex-col gap-1 px-3 py-4">
      {SECTIONS.map((section) => (
        <div key={section.heading ?? "top"} className={section.heading ? "mt-3" : ""}>
          {section.heading ? (
            <div className="px-3 pb-1 text-[0.65rem] font-medium uppercase tracking-wider text-ink-600">
              {t(section.heading)}
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            {section.items.map((item) => (
              <NavLink key={item.href} href={item.href} label={t(item.key)} active={isActive(pathname, item.href)} />
            ))}
          </div>
        </div>
      ))}
      <div className="mt-3">
        <NavLink href="/settings" label={t("nav.settings")} active={isActive(pathname, "/settings")} />
      </div>
      <div className="mt-auto px-3 pt-4">
        <Link href="/design" className="text-xs text-ink-600 transition-colors hover:text-gold-400">
          {t("nav.styleGuide")} →
        </Link>
      </div>
    </nav>
  );
}
