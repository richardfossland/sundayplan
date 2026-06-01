"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  createService,
  updateService,
  type ServiceFormState,
} from "@/app/(app)/services/actions";
import type { ServiceEditable, TemplateOption } from "@/lib/data/services";
import { useT } from "@/lib/i18n/client";

const initial: ServiceFormState = { error: null };

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";

function Actions({
  pending,
  submitLabel,
  cancelHref,
}: {
  pending: boolean;
  submitLabel: string;
  cancelHref: string;
}) {
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

function CommonFields({
  name,
  startsAtLocal,
  notes,
}: {
  name?: string;
  startsAtLocal?: string;
  notes?: string | null;
}) {
  const t = useT();
  return (
    <>
      <div>
        <label className={label}>{t("services.form.title")}</label>
        <input
          name="name"
          required
          defaultValue={name ?? ""}
          placeholder={t("services.form.titlePlaceholder")}
          className={input}
        />
      </div>
      <div>
        <label className={label}>{t("services.form.dateTime")}</label>
        <input
          name="starts_at_local"
          type="datetime-local"
          required
          defaultValue={startsAtLocal ?? ""}
          className={input}
        />
      </div>
      <div>
        <label className={label}>{t("services.form.notes")}</label>
        <textarea
          name="notes"
          rows={3}
          defaultValue={notes ?? ""}
          placeholder={t("services.form.notesPlaceholder")}
          className={input}
        />
      </div>
    </>
  );
}

export function NewServiceForm({
  templates,
  defaultDate,
}: {
  templates: TemplateOption[];
  /** Prefilled "YYYY-MM-DDTHH:mm" when arriving from a calendar day click. */
  defaultDate?: string;
}) {
  const t = useT();
  const [state, action, pending] = useActionState(createService, initial);
  return (
    <form action={action} className="space-y-4">
      <CommonFields startsAtLocal={defaultDate} />
      {templates.length > 0 ? (
        <div>
          <label className={label}>{t("services.form.startFromTemplate")}</label>
          <select name="template_id" defaultValue="" className={input}>
            <option value="">{t("services.form.blankNoTemplate")}</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name} · {t("services.minutes", { min: tpl.default_duration_min })}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-600">
            {t("services.form.templateHint")}
          </p>
        </div>
      ) : null}
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel={t("services.form.createSubmit")} cancelHref="/services" />
    </form>
  );
}

export function EditServiceForm({
  service,
  startsAtLocal,
}: {
  service: ServiceEditable;
  startsAtLocal: string;
}) {
  const t = useT();
  const bound = updateService.bind(null, service.id);
  const [state, action, pending] = useActionState(bound, initial);
  return (
    <form action={action} className="space-y-4">
      <CommonFields name={service.name} startsAtLocal={startsAtLocal} notes={service.notes} />
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel={t("common.save")} cancelHref={`/services/${service.id}`} />
    </form>
  );
}
