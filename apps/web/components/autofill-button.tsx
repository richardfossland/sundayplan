"use client";

import { useTransition } from "react";
import { autoFillSchedule } from "@/app/(app)/schedule/actions";
import { useT } from "@/lib/i18n/client";

export function AutoFillButton() {
  const t = useT();
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() => startTransition(() => autoFillSchedule())}
      disabled={pending}
      title={t("autofill.tooltip")}
      className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? t("autofill.busy") : `✨ ${t("autofill.cta")}`}
    </button>
  );
}
