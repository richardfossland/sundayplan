import { CHURCH_NAME } from "@/lib/mock";

export function TopBar() {
  return (
    <header className="flex h-14 items-center justify-between border-b border-white/[0.06] px-5">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-royal-500 to-royal-700 text-sm font-bold text-gold-300 shadow-inner">
          S
        </div>
        <span className="text-sm font-semibold tracking-tight text-ink-100">
          Sunday<span className="text-gold-400">Plan</span>
        </span>
        <span className="text-ink-700">/</span>
        <button className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-ink-300 transition-colors hover:bg-white/[0.04]">
          {CHURCH_NAME}
          <span className="text-ink-600">▾</span>
        </button>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-md border border-white/[0.07] px-2.5 py-1 text-xs text-ink-500 sm:flex">
          Search
          <kbd className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.65rem] text-ink-400">⌘K</kbd>
        </div>
        <div className="h-7 w-7 rounded-full bg-gradient-to-br from-gold-300 to-gold-600 text-center text-sm font-semibold leading-7 text-ink-950">
          R
        </div>
      </div>
    </header>
  );
}
