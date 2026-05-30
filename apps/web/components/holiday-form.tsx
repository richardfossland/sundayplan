"use client";

import { useActionState } from "react";
import Link from "next/link";
import { markChurchHoliday, type HolidayState } from "@/app/(app)/people/holiday/actions";
import { Card } from "@/components/ui";

const initial: HolidayState = { error: null, count: null };

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";

export function HolidayForm() {
  const [state, action, pending] = useActionState(markChurchHoliday, initial);
  return (
    <Card className="px-5 py-5">
      <form action={action} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Date</label>
            <input type="date" name="from" required className={input} />
          </div>
          <div>
            <label className={label}>To (optional — for a range)</label>
            <input type="date" name="to" className={input} />
          </div>
        </div>
        <div>
          <label className={label}>Reason (planner-visible)</label>
          <input name="reason" placeholder="e.g. Easter break" className={input} />
        </div>
        <div>
          <label className={label}>Apply to</label>
          <select name="scope" defaultValue="active" className={input}>
            <option value="active">Active members</option>
            <option value="all">All members</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Marking…" : "Mark holiday"}
          </button>
          <Link href="/people" className="text-sm text-ink-500 hover:text-ink-300">
            Back to people
          </Link>
          {state.error ? (
            <span className="text-xs text-[color:var(--color-danger)]">{state.error}</span>
          ) : null}
          {state.count != null ? (
            <span className="text-xs text-[color:var(--color-success)]">
              Marked {state.count} member{state.count === 1 ? "" : "s"} unavailable.
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
