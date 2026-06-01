"use client";

import { useT } from "@/lib/i18n/client";

/** The TopBar "Search ⌘K" affordance — opens the global command palette. */
export function CommandPaletteTrigger() {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
      className="hidden items-center gap-2 rounded-md border border-white/[0.07] px-2.5 py-1 text-xs text-ink-500 transition-colors hover:border-white/[0.14] hover:text-ink-300 sm:flex"
    >
      {t("shell.search")}
      <kbd className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.65rem] text-ink-400">⌘K</kbd>
    </button>
  );
}
