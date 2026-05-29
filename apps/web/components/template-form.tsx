"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  createTemplate,
  updateTemplate,
  type TemplateFormState,
} from "@/app/(app)/services/templates/actions";
import type { TemplateEditable } from "@/lib/data/templates";

const initial: TemplateFormState = { error: null };

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";

function Fields({ template }: { template?: TemplateEditable }) {
  return (
    <>
      <div>
        <label className={label}>Name</label>
        <input name="name" required defaultValue={template?.name ?? ""} placeholder="e.g. Standard Sunday Morning" className={input} />
      </div>
      <div>
        <label className={label}>Default duration (minutes)</label>
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

export function NewTemplateForm() {
  const [state, action, pending] = useActionState(createTemplate, initial);
  return (
    <form action={action} className="space-y-4">
      <Fields />
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel="Create template" cancelHref="/services/templates" />
    </form>
  );
}

export function EditTemplateForm({ template }: { template: TemplateEditable }) {
  const bound = updateTemplate.bind(null, template.id);
  const [state, action, pending] = useActionState(bound, initial);
  return (
    <form action={action} className="space-y-4">
      <Fields template={template} />
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel="Save changes" cancelHref={`/services/templates/${template.id}`} />
    </form>
  );
}
