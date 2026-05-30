"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/people", label: "People" },
  { href: "/teams", label: "Teams" },
  { href: "/services", label: "Services" },
  { href: "/schedule", label: "Schedule" },
  { href: "/songs", label: "Songs" },
  { href: "/messages", label: "Messages" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="flex h-full flex-col gap-1 px-3 py-4">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
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
            {item.label}
          </Link>
        );
      })}
      <div className="mt-auto px-3 pt-4">
        <Link href="/design" className="text-xs text-ink-600 transition-colors hover:text-gold-400">
          Style guide →
        </Link>
      </div>
    </nav>
  );
}
