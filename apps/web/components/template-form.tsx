"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  createTemplate,
  updateTemplate,
  type TemplateFormState,
} from "@/app/(app)/services/templates/actions";
import type { TemplateEditable } from "@/lib/data/templates";
import { useT } from "@/lib/i18n/client";

const initial: TemplateFormState = { error: null };

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";

function Fields({ template }: { template?: TemplateEditable }) {
  const t = useT();
  return (
    <>
      <div>
        <label className={label}>{t("templates.form.name")}</label>
        <input name="name" required defaultValue={template?.name ?? ""} placeholder={t("templates.form.namePlaceholder")} className={input} />
      </div>
      <div>
        <label className={label}>{t("templates.form.defaultDuration")}</label>
        <input
          name="default_duration_min"
          type="number"
          min={0}
          max={600}
          defaultValue={template?.default_duration_min ?? 75}
          className={input}
        />
      </div>
    </>
  );
}

function Actions({ pending, submitLabel, cancelHref }: { pending: boolean; submitLabel: string; cancelHref: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 pt-1">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? t("common.saving") : submitLabel}
      </button>
      <Link href={cancelHref} className="text-sm text-ink-500 hover:text-ink-300">
        {t("common.cancel")}
      </Link>
    </div>
  );
}

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-xs text-[color:var(--color-danger)]">{error}</p>;
}

export function NewTemplateForm() {
  const t = useT();
  const [state, action, pending] = useActionState(createTemplate, initial);
  return (
    <form action={action} className="space-y-4">
      <Fields />
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel={t("templates.form.createSubmit")} cancelHref="/services/templates" />
    </form>
  );
}

export function EditTemplateForm({ template }: { template: TemplateEditable }) {
  const t = useT();
  const bound = updateTemplate.bind(null, template.id);
  const [state, action, pending] = useActionState(bound, initial);
  return (
    <form action={action} className="space-y-4">
      <Fields template={template} />
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel={t("common.save")} cancelHref={`/services/templates/${template.id}`} />
    </form>
  );
}
