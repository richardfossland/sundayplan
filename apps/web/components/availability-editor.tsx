"use client";

import { useActionState, useState, useTransition } from "react";
import {
  addAvailability,
  removeAvailability,
  type AvailabilityState,
} from "@/app/(app)/people/availability-actions";
import type { AvailabilityRow } from "@/lib/data/availability";
import type { AvailabilityKind } from "@sundayplan/shared";
import { Card, CardHeader } from "@/components/ui";

const initial: AvailabilityState = { error: null };

const input =
  "rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";
const ghostBtn =
  "rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-ink-200 transition-colors hover:border-gold-400/40 hover:text-gold-300 disabled:opacity-50";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const KIND_LABEL: Record<AvailabilityKind, string> = {
  recurring: "Recurring",
  range: "Date range",
  specific: "Single date",
};

function AddForm({ memberId }: { memberId: string }) {
  const [state, action, pending] = useActionState(addAvailability.bind(null, memberId), initial);
  const [kind, setKind] = useState<AvailabilityKind>("specific");

  return (
    <form action={action} className="space-y-3 px-5 py-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Type</label>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as AvailabilityKind)}
            className={`${input} w-full`}
          >
            <option value="specific">Single date</option>
            <option value="range">Date range</option>
            <option value="recurring">Recurring weekday</option>
          </select>
        </div>
        {kind === "recurring" ? (
          <div>
            <label className={label}>Weekday</label>
            <select name="weekday" defaultValue="sunday" className={`${input} w-full capitalize`}>
              {WEEKDAYS.map((w) => (
                <option key={w} value={w} className="capitalize">
                  {w}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {kind === "specific" ? (
        <div>
          <label className={label}>Date</label>
          <input name="date" type="date" required className={`${input} w-full`} />
        </div>
      ) : null}

      {kind === "range" ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>From</label>
            <input name="from" type="date" required className={`${input} w-full`} />
          </div>
          <div>
            <label className={label}>To</label>
            <input name="to" type="date" required className={`${input} w-full`} />
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-[1fr_140px] gap-3">
        <div>
          <label className={label}>Reason (optional)</label>
          <input name="reason" placeholder="e.g. holiday, work travel" className={`${input} w-full`} />
        </div>
        <div>
          <label className={label}>Reason visible to</label>
          <select name="reason_visibility" defaultValue="planner" className={`${input} w-full`}>
            <option value="private">Private</option>
            <option value="planner">Planners</option>
            <option value="team">Team</option>
          </select>
        </div>
      </div>

      {state.error ? <p className="text-xs text-[color:var(--color-danger)]">{state.error}</p> : null}
      <button type="submit" disabled={pending} className={ghostBtn}>
        {pending ? "Adding…" : "+ Add unavailability"}
      </button>
    </form>
  );
}

function Row({ memberId, row }: { memberId: string; row: AvailabilityRow }) {
  const [pending, startTransition] = useTransition();
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium uppercase text-ink-400">
            {KIND_LABEL[row.kind]}
          </span>
          <span className="text-sm text-ink-100">{row.summary}</span>
        </div>
        {row.reason ? (
          <p className="mt-0.5 text-xs text-ink-500">{row.reason}</p>
        ) : row.reason_visibility === "private" ? (
          <p className="mt-0.5 text-xs italic text-ink-600">reason hidden</p>
        ) : null}
      </div>
      <button
        onClick={() => startTransition(() => removeAvailability(memberId, row.id))}
        disabled={pending}
        aria-label="Remove"
        className="text-ink-600 transition-colors hover:text-[color:var(--color-danger)] disabled:opacity-40"
      >
        ×
      </button>
    </li>
  );
}

export function AvailabilityEditor({
  memberId,
  rows,
}: {
  memberId: string;
  rows: AvailabilityRow[];
}) {
  return (
    <Card>
      <CardHeader title="Unavailability" sub="When this person can't serve — feeds auto-fill + conflicts" />
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-500">
          No blocks set — assumed available for every service.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {rows.map((r) => (
            <Row key={r.id} memberId={memberId} row={r} />
          ))}
        </ul>
      )}
      <div className="border-t border-white/[0.06]">
        <AddForm memberId={memberId} />
      </div>
    </Card>
  );
}
