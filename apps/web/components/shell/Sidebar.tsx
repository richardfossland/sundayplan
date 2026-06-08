"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  CalendarRange,
  ArrowLeftRight,
  Music,
  Users,
  UsersRound,
  MessageSquare,
  BarChart3,
  Settings,
  Palette,
  type LucideIcon,
} from "lucide-react";
import { useT } from "@/lib/i18n/client";

// Grouped navigation. PC-style top dropdowns are exactly what users complain
// loses them ("not clear where to find things"), so we keep a flat left rail
// but label it by intent — Plan / People / Engage — for instant orientation.
// Each item carries an icon so the rail reads at a glance, not as a wall of text.
const SECTIONS: { heading: string | null; items: { href: string; key: string; icon: LucideIcon }[] }[] = [
  { heading: null, items: [{ href: "/", key: "nav.dashboard", icon: LayoutDashboard }] },
  {
    heading: "nav.section.plan",
    items: [
      { href: "/services", key: "nav.services", icon: CalendarDays },
      { href: "/schedule", key: "nav.schedule", icon: CalendarRange },
      { href: "/swaps", key: "nav.swaps", icon: ArrowLeftRight },
      { href: "/songs", key: "nav.songs", icon: Music },
    ],
  },
  {
    heading: "nav.section.people",
    items: [
      { href: "/people", key: "nav.people", icon: Users },
      { href: "/teams", key: "nav.teams", icon: UsersRound },
    ],
  },
  {
    heading: "nav.section.engage",
    items: [
      { href: "/messages", key: "nav.messages", icon: MessageSquare },
      { href: "/reports", key: "nav.reports", icon: BarChart3 },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors " +
        (active ? "bg-white/[0.06] text-ink-50" : "text-ink-400 hover:bg-white/[0.04] hover:text-ink-200")
      }
    >
      <span
        className={
          "absolute left-0 h-4 w-0.5 rounded-full bg-gold-400 transition-opacity " +
          (active ? "opacity-100" : "opacity-0")
        }
      />
      <Icon
        size={16}
        strokeWidth={1.75}
        className={active ? "text-gold-300" : "text-ink-500 group-hover:text-ink-300"}
        aria-hidden
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
      <Link href="/" className="mb-3 flex items-center gap-2.5 px-2">
        <Image src="/logo.svg" alt="" width={28} height={28} className="rounded-[22%]" priority unoptimized />
        <span className="text-[0.95rem] font-semibold tracking-tight text-ink-50">
          Sunday<span className="text-gold-400">Plan</span>
        </span>
      </Link>
      {SECTIONS.map((section) => (
        <div key={section.heading ?? "top"} className={section.heading ? "mt-3" : ""}>
          {section.heading ? (
            <div className="px-3 pb-1 text-[0.65rem] font-medium uppercase tracking-wider text-ink-600">
              {t(section.heading)}
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            {section.items.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={t(item.key)}
                icon={item.icon}
                active={isActive(pathname, item.href)}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="mt-3">
        <NavLink href="/settings" label={t("nav.settings")} icon={Settings} active={isActive(pathname, "/settings")} />
      </div>
      <div className="mt-auto px-3 pt-4">
        <Link
          href="/design"
          className="flex items-center gap-1.5 text-xs text-ink-600 transition-colors hover:text-gold-400"
        >
          <Palette size={13} strokeWidth={1.75} aria-hidden />
          {t("nav.styleGuide")} →
        </Link>
      </div>
    </nav>
  );
}
