"use client";

import { useActionState } from "react";
import Link from "next/link";
import { importMembers, type ImportState } from "@/app/(app)/people/import/actions";
import { Card } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

const initial: ImportState = { error: null, summary: null };

const PLACEHOLDER = `name,phone,email,household,tags
Ada Hansen,+47 912 34 567,ada@x.no,Hansen,worship|tech
Bo Olsen,90011223,,Olsen,sound`;

export function ImportForm() {
  const t = useT();
  const [state, action, pending] = useActionState(importMembers, initial);
  const s = state.summary;
  return (
    <div className="space-y-4">
      <Card className="px-5 py-5">
        <form action={action} className="space-y-3">
          <label className="block text-xs font-medium text-ink-400">
            {t("people.pasteRowsLabel")}
          </label>
          <textarea
            name="paste"
            rows={10}
            placeholder={PLACEHOLDER}
            className="w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 font-mono text-xs text-ink-100 outline-none placeholder:text-ink-700 focus:border-gold-400/50"
          />
          <p className="text-xs text-ink-600">{t("people.importHint")}</p>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pending ? t("people.importing") : t("people.import")}
            </button>
            <Link href="/people" className="text-sm text-ink-500 hover:text-ink-300">
              {t("people.backToPeople")}
            </Link>
            {state.error ? (
              <span className="text-xs text-[color:var(--color-danger)]">{state.error}</span>
            ) : null}
          </div>
        </form>
      </Card>

      {s ? (
        <Card className="px-5 py-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-[color:var(--color-success)]">{t("people.summaryImported", { n: s.inserted })}</span>
            {s.skippedExisting > 0 ? (
              <span className="text-ink-400">{t("people.summaryExisted", { n: s.skippedExisting })}</span>
            ) : null}
            {s.duplicates > 0 ? (
              <span className="text-ink-400">{t("people.summaryDuplicates", { n: s.duplicates })}</span>
            ) : null}
            {s.errors.length > 0 ? (
              <span className="text-[color:var(--color-warning)]">{t("people.summarySkipped", { n: s.errors.length })}</span>
            ) : null}
          </div>
          {s.errors.length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs text-ink-400">
              {s.errors.map((e) => (
                <li key={e.line}>
                  {t("people.lineError", { line: e.line, message: e.message })}
                </li>
              ))}
            </ul>
          ) : null}
          {s.inserted > 0 ? (
            <Link href="/people" className="mt-3 inline-block text-sm text-gold-300 hover:text-gold-200">
              {t("people.viewPeople")}
            </Link>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
