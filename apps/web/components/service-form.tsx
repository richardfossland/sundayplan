"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  createService,
  updateService,
  type ServiceFormState,
} from "@/app/(app)/services/actions";
import type { ServiceEditable, TemplateOption } from "@/lib/data/services";

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
  return (
    <div className="flex items-center gap-3 pt-1">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
      <Link href={cancelHref} className="text-sm text-ink-500 hover:text-ink-300">
        Cancel
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
  return (
    <>
      <div>
        <label className={label}>Title</label>
        <input
          name="name"
          required
          defaultValue={name ?? ""}
          placeholder="e.g. Easter Sunday"
          className={input}
        />
      </div>
      <div>
        <label className={label}>Date &amp; time</label>
        <input
          name="starts_at_local"
          type="datetime-local"
          required
          defaultValue={startsAtLocal ?? ""}
          className={input}
        />
      </div>
      <div>
        <label className={label}>Notes</label>
        <textarea
          name="notes"
          rows={3}
          defaultValue={notes ?? ""}
          placeholder="Anything the team should know…"
          className={input}
        />
      </div>
    </>
  );
}

export function NewServiceForm({ templates }: { templates: TemplateOption[] }) {
  const [state, action, pending] = useActionState(createService, initial);
  return (
    <form action={action} className="space-y-4">
      <CommonFields />
      {templates.length > 0 ? (
        <div>
          <label className={label}>Start from template</label>
          <select name="template_id" defaultValue="" className={input}>
            <option value="">Blank (no template)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.default_duration_min} min
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-600">
            A template seeds the order of service; you can edit it afterwards.
          </p>
        </div>
      ) : null}
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel="Create service" cancelHref="/services" />
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
  const bound = updateService.bind(null, service.id);
  const [state, action, pending] = useActionState(bound, initial);
  return (
    <form action={action} className="space-y-4">
      <CommonFields name={service.name} startsAtLocal={startsAtLocal} notes={service.notes} />
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel="Save changes" cancelHref={`/services/${service.id}`} />
    </form>
  );
}
