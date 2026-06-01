"use client";

import { useActionState, useTransition } from "react";
import { addBlockout, removeBlockout, type Blockout, type BlockoutResult } from "@/app/r/[token]/availability/actions";
import { translate, type Locale } from "@/lib/i18n/messages";

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";

const initial: BlockoutResult = { ok: false };

export function VolunteerAvailabilityForm({
  token,
  blockouts,
  locale,
}: {
  token: string;
  blockouts: Blockout[];
  locale: Locale;
}) {
  const t = (key: string) => translate(locale, key);
  const action = addBlockout.bind(null, token);
  const [state, formAction, pending] = useActionState(action, initial);
  const [removing, startRemove] = useTransition();

  return (
    <div className="space-y-5">
      {blockouts.length > 0 ? (
        <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 px-4 py-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-500">
            {t("vol.avail.yourBlockouts")}
          </p>
          <ul className="space-y-1.5">
            {blockouts.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 text-sm text-ink-200">
                <span>
                  {b.label}
                  {b.reason ? <span className="ml-2 text-xs text-ink-500">{b.reason}</span> : null}
                </span>
                <button
                  onClick={() => startRemove(() => removeBlockout(token, b.id))}
                  disabled={removing}
                  aria-label={t("vol.avail.removeBlockout")}
                  className="text-ink-600 transition-colors hover:text-[color:var(--color-danger)] disabled:opacity-40"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form action={formAction} className="space-y-4 rounded-xl border border-white/[0.07] bg-ink-900/60 px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>{t("vol.avail.from")}</label>
            <input name="from" type="date" required className={input} />
          </div>
          <div>
            <label className={label}>{t("vol.avail.to")}</label>
            <input name="to" type="date" className={input} />
          </div>
        </div>
        <div>
          <label className={label}>{t("vol.avail.reason")}</label>
          <input name="reason" placeholder={t("vol.avail.reasonPlaceholder")} className={input} />
        </div>
        {state.error ? <p className="text-xs text-[color:var(--color-danger)]">{state.error}</p> : null}
        {state.ok ? (
          <p className="text-xs text-[color:var(--color-success)]">{t("vol.avail.added")}</p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-gold-400 px-4 py-2.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? t("vol.avail.adding") : t("vol.avail.add")}
        </button>
      </form>
    </div>
  );
}
