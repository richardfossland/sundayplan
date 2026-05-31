"use client";

import { useState, useTransition } from "react";
import type { GridService } from "@/lib/data/schedule";
import { copyWeek } from "@/app/(app)/schedule/actions";

/**
 * Per-column "Copy from" control — picks another service and clones its roster
 * onto this one as pending proposals. Mirrors PC's copy-a-week-to-the-next.
 */
export function CopyWeek({ targetId, services }: { targetId: string; services: GridService[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const sources = services.filter((s) => s.id !== targetId);
  if (sources.length === 0) return null;

  function copy(fromId: string) {
    setOpen(false);
    startTransition(() => copyWeek(fromId, targetId));
  }

  return (
    <div className="relative mt-1 inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="text-[0.65rem] text-ink-600 transition-colors hover:text-gold-300 disabled:opacity-40"
        title="Copy another service's roster here"
      >
        {pending ? "Copying…" : "⧉ Copy from"}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-6 z-30 max-h-60 min-w-40 overflow-y-auto rounded-lg border border-white/10 bg-ink-900 p-1 shadow-xl">
            {sources.map((s) => (
              <button
                key={s.id}
                onClick={() => copy(s.id)}
                className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-ink-200 transition-colors hover:bg-white/[0.06]"
              >
                {s.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
