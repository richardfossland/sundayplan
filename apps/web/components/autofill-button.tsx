"use client";

import { useTransition } from "react";
import { autoFillSchedule } from "@/app/(app)/schedule/actions";

export function AutoFillButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => startTransition(() => autoFillSchedule())}
      disabled={pending}
      title="Fill open slots with the best-matched volunteers — you review the draft"
      className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "Filling…" : "✨ Auto-fill gaps"}
    </button>
  );
}
