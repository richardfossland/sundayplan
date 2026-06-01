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
import { useT } from "@/lib/i18n/client";

const initial: AvailabilityState = { error: null };

const input =
  "rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";
const ghostBtn =
  "rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-ink-200 transition-colors hover:border-gold-400/40 hover:text-gold-300 disabled:opacity-50";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const KIND_LABEL_KEY: Record<AvailabilityKind, string> = {
  recurring: "people.kindRecurring",
  range: "people.kindRange",
  specific: "people.kindSpecific",
};

function AddForm({ memberId }: { memberId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(addAvailability.bind(null, memberId), initial);
  const [kind, setKind] = useState<AvailabilityKind>("specific");

  return (
    <form action={action} className="space-y-3 px-5 py-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{t("people.type")}</label>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as AvailabilityKind)}
            className={`${input} w-full`}
          >
            <option value="specific">{t("people.kindSpecific")}</option>
            <option value="range">{t("people.kindRange")}</option>
            <option value="recurring">{t("people.kindRecurringWeekday")}</option>
          </select>
        </div>
        {kind === "recurring" ? (
          <div>
            <label className={label}>{t("people.weekday")}</label>
            <select name="weekday" defaultValue="sunday" className={`${input} w-full`}>
              {WEEKDAYS.map((w) => (
                <option key={w} value={w}>
                  {t(`people.weekday_${w}`)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {kind === "specific" ? (
        <div>
          <label className={label}>{t("people.date")}</label>
          <input name="date" type="date" required className={`${input} w-full`} />
        </div>
      ) : null}

      {kind === "range" ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>{t("people.from")}</label>
            <input name="from" type="date" required className={`${input} w-full`} />
          </div>
          <div>
            <label className={label}>{t("people.to")}</label>
            <input name="to" type="date" required className={`${input} w-full`} />
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-[1fr_140px] gap-3">
        <div>
          <label className={label}>{t("people.reasonOptional")}</label>
          <input name="reason" placeholder={t("people.reasonPlaceholder")} className={`${input} w-full`} />
        </div>
        <div>
          <label className={label}>{t("people.reasonVisibleTo")}</label>
          <select name="reason_visibility" defaultValue="planner" className={`${input} w-full`}>
            <option value="private">{t("people.visPrivate")}</option>
            <option value="planner">{t("people.visPlanners")}</option>
            <option value="team">{t("people.visTeam")}</option>
          </select>
        </div>
      </div>

      {state.error ? <p className="text-xs text-[color:var(--color-danger)]">{state.error}</p> : null}
      <button type="submit" disabled={pending} className={ghostBtn}>
        {pending ? t("people.adding") : t("people.addUnavailability")}
      </button>
    </form>
  );
}

function Row({ memberId, row }: { memberId: string; row: AvailabilityRow }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium uppercase text-ink-400">
            {t(KIND_LABEL_KEY[row.kind])}
          </span>
          <span className="text-sm text-ink-100">{row.summary}</span>
        </div>
        {row.reason ? (
          <p className="mt-0.5 text-xs text-ink-500">{row.reason}</p>
        ) : row.reason_visibility === "private" ? (
          <p className="mt-0.5 text-xs italic text-ink-600">{t("people.reasonHidden")}</p>
        ) : null}
      </div>
      <button
        onClick={() => startTransition(() => removeAvailability(memberId, row.id))}
        disabled={pending}
        aria-label={t("people.remove")}
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
  const t = useT();
  return (
    <Card>
      <CardHeader title={t("people.unavailability")} sub={t("people.unavailabilitySub")} />
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-500">{t("people.noBlocks")}</p>
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
