"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchResults } from "@/lib/data/search";
import { useT } from "@/lib/i18n/client";

interface Item {
  group: string;
  label: string;
  sub?: string;
  href: string;
}

interface StaticItem {
  groupKey: string;
  labelKey: string;
  subKey?: string;
  href: string;
}

// Static destinations + quick actions — mirror the sidebar so ⌘K is a faster
// path to anywhere. Filtered by the query before any DB results are shown.
const NAV: StaticItem[] = [
  { groupKey: "shell.group.goTo", labelKey: "nav.dashboard", href: "/" },
  { groupKey: "shell.group.goTo", labelKey: "nav.people", href: "/people" },
  { groupKey: "shell.group.goTo", labelKey: "nav.teams", href: "/teams" },
  { groupKey: "shell.group.goTo", labelKey: "nav.services", href: "/services" },
  { groupKey: "shell.group.goTo", labelKey: "nav.schedule", href: "/schedule" },
  { groupKey: "shell.group.goTo", labelKey: "nav.songs", href: "/songs" },
  { groupKey: "shell.group.goTo", labelKey: "nav.messages", href: "/messages" },
  { groupKey: "shell.group.goTo", labelKey: "nav.reports", href: "/reports" },
  { groupKey: "shell.group.goTo", labelKey: "nav.settings", href: "/settings" },
];

const ACTIONS: StaticItem[] = [
  { groupKey: "shell.group.actions", labelKey: "action.newService", subKey: "action.newService.sub", href: "/services/new" },
  { groupKey: "shell.group.actions", labelKey: "action.newPerson", subKey: "action.newPerson.sub", href: "/people/new" },
  { groupKey: "shell.group.actions", labelKey: "action.newTeam", subKey: "action.newTeam.sub", href: "/teams/new" },
  { groupKey: "shell.group.actions", labelKey: "action.openSchedule", subKey: "action.openSchedule.sub", href: "/schedule" },
  { groupKey: "shell.group.actions", labelKey: "action.compose", subKey: "action.compose.sub", href: "/messages/compose" },
  { groupKey: "shell.group.actions", labelKey: "action.calendar", subKey: "action.calendar.sub", href: "/services/calendar" },
];

const EMPTY: SearchResults = { people: [], songs: [], services: [] };

export function CommandPalette() {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open on ⌘K / Ctrl-K from anywhere, and on the TopBar trigger event.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onTrigger() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onTrigger);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onTrigger);
    };
  }, []);

  // Reset and focus when opened.
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults(EMPTY);
      setActive(0);
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Debounced server search.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults(EMPTY);
      return;
    }
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) setResults((await res.json()) as SearchResults);
      } catch {
        /* aborted or offline — keep prior results */
      }
    }, 180);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [query, open]);

  // Flatten everything currently visible into one selectable list.
  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const resolve = (i: StaticItem): Item => ({
      group: t(i.groupKey),
      label: t(i.labelKey),
      sub: i.subKey ? t(i.subKey) : undefined,
      href: i.href,
    });
    const match = (i: Item) => q.length === 0 || i.label.toLowerCase().includes(q);
    const nav = NAV.map(resolve).filter(match);
    const actions = ACTIONS.map(resolve).filter(match);
    const people: Item[] = results.people.map((p) => ({ group: t("shell.group.people"), label: p.name, href: `/people/${p.id}` }));
    const songs: Item[] = results.songs.map((s) => ({
      group: t("shell.group.songs"),
      label: s.title,
      sub: s.author ?? undefined,
      href: `/songs/${s.id}`,
    }));
    const services: Item[] = results.services.map((s) => ({
      group: t("shell.group.services"),
      label: s.name,
      href: `/services/${s.id}`,
    }));
    return [...actions, ...people, ...songs, ...services, ...nav];
  }, [query, results, t]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, items.length - 1)));
  }, [items.length]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[active];
      if (item) go(item.href);
    }
  }

  if (!open) return null;

  // Group consecutive items for section headers while keeping a flat index.
  let flatIndex = -1;
  let lastGroup = "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-white/[0.1] bg-ink-900/95 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          placeholder={t("shell.searchPlaceholder")}
          className="w-full border-b border-white/[0.08] bg-transparent px-4 py-3.5 text-sm text-ink-50 outline-none placeholder:text-ink-600"
        />
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-500">{t("shell.noMatches")}</p>
          ) : (
            items.map((item) => {
              flatIndex += 1;
              const idx = flatIndex;
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              return (
                <div key={`${item.group}-${item.href}-${idx}`}>
                  {header ? (
                    <div className="px-4 pb-1 pt-3 text-[0.65rem] font-medium uppercase tracking-wider text-ink-600">
                      {header}
                    </div>
                  ) : null}
                  <button
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => go(item.href)}
                    className={
                      "flex w-full items-baseline gap-2 px-4 py-2 text-left text-sm transition-colors " +
                      (idx === active ? "bg-white/[0.07] text-ink-50" : "text-ink-200 hover:bg-white/[0.04]")
                    }
                  >
                    <span>{item.label}</span>
                    {item.sub ? <span className="text-xs text-ink-500">{item.sub}</span> : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
