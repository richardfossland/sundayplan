"use client";

import { useActionState, useState, useTransition } from "react";
import {
  addTemplateItem,
  updateTemplateItem,
  removeTemplateItem,
  moveTemplateItem,
  setRequirement,
  removeRequirement,
  type RowState,
} from "@/app/(app)/services/templates/actions";
import type { TemplateItemRow, RequirementRow, RoleOption } from "@/lib/data/templates";
import type { TemplateItemKind } from "@sundayplan/shared";
import { Card, CardHeader } from "@/components/ui";

const KINDS: { value: TemplateItemKind; label: string }[] = [
  { value: "welcome", label: "Welcome" },
  { value: "worship_set", label: "Worship set" },
  { value: "scripture", label: "Scripture" },
  { value: "sermon", label: "Sermon" },
  { value: "response", label: "Response" },
  { value: "announcement", label: "Announcement" },
  { value: "closing", label: "Closing" },
  { value: "gap", label: "Gap / transition" },
];

const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label])) as Record<TemplateItemKind, string>;

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";
const ghostBtn =
  "rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-ink-200 transition-colors hover:border-gold-400/40 hover:text-gold-300 disabled:opacity-50";
const initial: RowState = { error: null };

// ── Items ─────────────────────────────────────────────────────────────────────

function ItemFields({ item }: { item?: TemplateItemRow }) {
  return (
    <div className="grid grid-cols-[1fr_150px_110px] gap-3">
      <div>
        <label className={label}>Label</label>
        <input name="label" required defaultValue={item?.label ?? ""} placeholder="e.g. Worship set" className={input} />
      </div>
      <div>
        <label className={label}>Section</label>
        <select name="kind" defaultValue={item?.kind ?? "welcome"} className={input}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={label}>Minutes</label>
        <input name="duration_min" type="number" min={0} max={360} defaultValue={item?.duration_min ?? 0} className={input} />
      </div>
    </div>
  );
}

function AddItemForm({ templateId }: { templateId: string }) {
  const [state, action, pending] = useActionState(addTemplateItem.bind(null, templateId), initial);
  return (
    <form action={action} className="space-y-3 rounded-xl border border-dashed border-white/10 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Add section</p>
      <ItemFields />
      {state.error ? <p className="text-xs text-[color:var(--color-danger)]">{state.error}</p> : null}
      <button type="submit" disabled={pending} className={ghostBtn}>
        {pending ? "Adding…" : "+ Add section"}
      </button>
    </form>
  );
}

function EditItemForm({ templateId, item, onDone }: { templateId: string; item: TemplateItemRow; onDone: () => void }) {
  const bound = updateTemplateItem.bind(null, templateId, item.position);
  const [state, action, pending] = useActionState(async (prev: RowState, fd: FormData) => {
    const r = await bound(prev, fd);
    if (!r.error) onDone();
    return r;
  }, initial);
  return (
    <form action={action} className="space-y-3 rounded-xl border border-gold-400/30 bg-ink-950/40 p-4">
      <ItemFields item={item} />
      {state.error ? <p className="text-xs text-[color:var(--color-danger)]">{state.error}</p> : null}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={ghostBtn}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-ink-500 hover:text-ink-300">
          Cancel
        </button>
      </div>
    </form>
  );
}

function ItemRow({ templateId, item, index, count }: { templateId: string; item: TemplateItemRow; index: number; count: number }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  if (editing) return <EditItemForm templateId={templateId} item={item} onDone={() => setEditing(false)} />;

  const move = (dir: "up" | "down") => startTransition(() => void moveTemplateItem(templateId, item.position, dir));
  const remove = () => startTransition(() => void removeTemplateItem(templateId, item.position));

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-ink-900/40 px-4 py-3">
      <div className="flex flex-col">
        <button onClick={() => move("up")} disabled={index === 0 || pending} aria-label="Move up" className="text-ink-500 hover:text-ink-200 disabled:opacity-25">▲</button>
        <button onClick={() => move("down")} disabled={index === count - 1 || pending} aria-label="Move down" className="text-ink-500 hover:text-ink-200 disabled:opacity-25">▼</button>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium uppercase text-ink-400">{KIND_LABEL[item.kind]}</span>
          <span className="font-medium text-ink-100">{item.label}</span>
          {item.duration_min > 0 ? <span className="text-xs text-ink-500">{item.duration_min} min</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs">
        <button onClick={() => setEditing(true)} className="text-ink-400 hover:text-gold-300">Edit</button>
        <button onClick={remove} disabled={pending} className="text-ink-500 hover:text-[color:var(--color-danger)] disabled:opacity-50">Delete</button>
      </div>
    </div>
  );
}

// ── Requirements ────────────────────────────────────────────────────────────

function AddRequirementForm({ templateId, roles, used }: { templateId: string; roles: RoleOption[]; used: Set<string> }) {
  const [state, action, pending] = useActionState(setRequirement.bind(null, templateId), initial);
  const available = roles.filter((r) => !used.has(r.id));
  if (available.length === 0) {
    return <p className="px-5 py-4 text-xs text-ink-600">Every role is already required. Add more roles under Teams to require them here.</p>;
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 px-5 py-4">
      <select name="role_id" defaultValue="" required className={`${input} max-w-[240px]`}>
        <option value="" disabled>Add role requirement…</option>
        {available.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} · {r.team_name}
          </option>
        ))}
      </select>
      <input name="quantity" type="number" min={1} max={20} defaultValue={1} className={`${input} w-20`} aria-label="Quantity" />
      <button type="submit" disabled={pending} className={ghostBtn}>
        {pending ? "Adding…" : "+ Require"}
      </button>
      {state.error ? <span className="text-xs text-[color:var(--color-danger)]">{state.error}</span> : null}
    </form>
  );
}

function RequirementList({ templateId, requirements }: { templateId: string; requirements: RequirementRow[] }) {
  const [pending, startTransition] = useTransition();
  if (requirements.length === 0) {
    return <p className="px-5 py-6 text-center text-sm text-ink-500">No roles required yet — services from this template won&apos;t flag unfilled slots.</p>;
  }
  return (
    <ul className="divide-y divide-white/[0.05]">
      {requirements.map((r) => (
        <li key={r.role_id} className="flex items-center justify-between gap-3 px-5 py-3">
          <span className="text-sm text-ink-100">{r.role_name}</span>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-ink-500">× {r.quantity}</span>
            <button
              onClick={() => startTransition(() => removeRequirement(templateId, r.role_id))}
              disabled={pending}
              aria-label={`Remove ${r.role_name} requirement`}
              className="text-ink-600 hover:text-[color:var(--color-danger)] disabled:opacity-40"
            >
              ×
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Composite editor ──────────────────────────────────────────────────────────

export function TemplateEditor({
  templateId,
  items,
  requirements,
  roles,
}: {
  templateId: string;
  items: TemplateItemRow[];
  requirements: RequirementRow[];
  roles: RoleOption[];
}) {
  const totalMin = items.reduce((sum, i) => sum + i.duration_min, 0);
  const used = new Set(requirements.map((r) => r.role_id));
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight text-ink-100">Default order</h2>
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-ink-500">No sections yet. Add the first below.</p>
        ) : (
          items.map((item, i) => (
            <ItemRow key={item.position} templateId={templateId} item={item} index={i} count={items.length} />
          ))
        )}
        {items.length > 0 ? (
          <p className="px-1 text-right text-xs text-ink-500">
            Sections total: <span className="text-ink-300">{totalMin} min</span>
          </p>
        ) : null}
        <AddItemForm templateId={templateId} />
      </section>

      <aside>
        <Card>
          <CardHeader title="Roles needed" sub="Drives unfilled-slot warnings" />
          <RequirementList templateId={templateId} requirements={requirements} />
          <div className="border-t border-white/[0.06]">
            <AddRequirementForm templateId={templateId} roles={roles} used={used} />
          </div>
        </Card>
      </aside>
    </div>
  );
}
