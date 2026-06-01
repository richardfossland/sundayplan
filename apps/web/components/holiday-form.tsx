"use client";

import { useActionState } from "react";
import Link from "next/link";
import { markChurchHoliday, type HolidayState } from "@/app/(app)/people/holiday/actions";
import { Card } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

const initial: HolidayState = { error: null, count: null };

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";

export function HolidayForm() {
  const t = useT();
  const [state, action, pending] = useActionState(markChurchHoliday, initial);
  return (
    <Card className="px-5 py-5">
      <form action={action} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>{t("people.date")}</label>
            <input type="date" name="from" required className={input} />
          </div>
          <div>
            <label className={label}>{t("people.toRange")}</label>
            <input type="date" name="to" className={input} />
          </div>
        </div>
        <div>
          <label className={label}>{t("people.reasonPlannerVisible")}</label>
          <input name="reason" placeholder={t("people.easterBreakPlaceholder")} className={input} />
        </div>
        <div>
          <label className={label}>{t("people.applyTo")}</label>
          <select name="scope" defaultValue="active" className={input}>
            <option value="active">{t("people.activeMembers")}</option>
            <option value="all">{t("people.allMembers")}</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? t("people.marking") : t("people.markHoliday")}
          </button>
          <Link href="/people" className="text-sm text-ink-500 hover:text-ink-300">
            {t("people.backToPeople")}
          </Link>
          {state.error ? (
            <span className="text-xs text-[color:var(--color-danger)]">{state.error}</span>
          ) : null}
          {state.count != null ? (
            <span className="text-xs text-[color:var(--color-success)]">
              {t(
                state.count === 1 ? "people.markedUnavailableOne" : "people.markedUnavailableMany",
                { n: state.count },
              )}
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
