"use client";

import { useActionState, useState, useTransition } from "react";
import {
  addServiceItem,
  updateServiceItem,
  removeServiceItem,
  moveServiceItem,
  type ItemState,
} from "@/app/(app)/services/actions";
import type { ServiceItemRow } from "@/lib/data/services";
import type { ServiceItemKind } from "@sundayplan/shared";

const KINDS: { value: ServiceItemKind; label: string }[] = [
  { value: "welcome", label: "Welcome" },
  { value: "song", label: "Song" },
  { value: "scripture", label: "Scripture" },
  { value: "sermon", label: "Sermon" },
  { value: "announcement", label: "Announcement" },
  { value: "gap", label: "Gap / transition" },
];

const KIND_LABEL: Record<ServiceItemKind, string> = Object.fromEntries(
  KINDS.map((k) => [k.value, k.label]),
) as Record<ServiceItemKind, string>;

const KIND_TONE: Record<ServiceItemKind, string> = {
  welcome: "bg-sky-500/15 text-sky-300",
  song: "bg-gold-400/15 text-gold-300",
  scripture: "bg-emerald-500/15 text-emerald-300",
  sermon: "bg-violet-500/15 text-violet-300",
  announcement: "bg-ink-500/20 text-ink-300",
  gap: "bg-ink-700/40 text-ink-500",
};

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";
const initial: ItemState = { error: null };

function ItemFields({ item }: { item?: ServiceItemRow }) {
  const [kind, setKind] = useState<ServiceItemKind>(item?.kind ?? "welcome");
  return (
    <>
      <div className="grid grid-cols-[1fr_120px_110px] gap-3">
        <div>
          <label className={label}>Label</label>
          <input name="label" required defaultValue={item?.label ?? ""} placeholder="e.g. Worship set" className={input} />
        </div>
        <div>
          <label className={label}>Type</label>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as ServiceItemKind)}
            className={input}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Minutes</label>
          <input
            name="duration_min"
            type="number"
            min={0}
            max={360}
            defaultValue={item?.duration_min ?? 0}
            className={input}
          />
        </div>
      </div>
      {kind === "scripture" ? (
        <div>
          <label className={label}>Scripture reference</label>
          <input
            name="scripture_ref"
            defaultValue={item?.scripture_ref ?? ""}
            placeholder="e.g. John 3:16–21"
            className={input}
          />
        </div>
      ) : null}
      <div>
        <label className={label}>Notes</label>
        <input name="notes" defaultValue={item?.notes ?? ""} placeholder="Optional" className={input} />
      </div>
    </>
  );
}

function AddItemForm({ serviceId }: { serviceId: string }) {
  const bound = addServiceItem.bind(null, serviceId);
  const [state, action, pending] = useActionState(bound, initial);
  return (
    <form action={action} className="space-y-3 rounded-xl border border-dashed border-white/10 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Add to order of service</p>
      <ItemFields />
      {state.error ? (
        <p className="text-xs text-[color:var(--color-danger)]">{state.error}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Adding…" : "+ Add item"}
      </button>
    </form>
  );
}

function EditItemForm({
  serviceId,
  item,
  onDone,
}: {
  serviceId: string;
  item: ServiceItemRow;
  onDone: () => void;
}) {
  const bound = updateServiceItem.bind(null, serviceId, item.id);
  const [state, action, pending] = useActionState(
    async (prev: ItemState, fd: FormData) => {
      const result = await bound(prev, fd);
      if (!result.error) onDone();
      return result;
    },
    initial,
  );
  return (
    <form action={action} className="space-y-3 rounded-xl border border-gold-400/30 bg-ink-950/40 p-4">
      <ItemFields item={item} />
      {state.error ? (
        <p className="text-xs text-[color:var(--color-danger)]">{state.error}</p>
      ) : null}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-ink-500 hover:text-ink-300">
          Cancel
        </button>
      </div>
    </form>
  );
}

function ItemRow({
  serviceId,
  item,
  index,
  count,
}: {
  serviceId: string;
  item: ServiceItemRow;
  index: number;
  count: number;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  if (editing) {
    return <EditItemForm serviceId={serviceId} item={item} onDone={() => setEditing(false)} />;
  }

  const move = (direction: "up" | "down") =>
    startTransition(() => {
      void moveServiceItem(serviceId, item.id, direction);
    });
  const remove = () =>
    startTransition(() => {
      void removeServiceItem(serviceId, item.id);
    });

  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/8 bg-ink-900/40 px-4 py-3">
      <div className="flex flex-col pt-0.5">
        <button
          onClick={() => move("up")}
          disabled={index === 0 || pending}
          aria-label="Move up"
          className="text-ink-500 transition-colors hover:text-ink-200 disabled:opacity-25"
        >
          ▲
        </button>
        <button
          onClick={() => move("down")}
          disabled={index === count - 1 || pending}
          aria-label="Move down"
          className="text-ink-500 transition-colors hover:text-ink-200 disabled:opacity-25"
        >
          ▼
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${KIND_TONE[item.kind]}`}>
            {KIND_LABEL[item.kind]}
          </span>
          <span className="font-medium text-ink-100">{item.label}</span>
          {item.duration_min > 0 ? (
            <span className="text-xs text-ink-500">{item.duration_min} min</span>
          ) : null}
        </div>
        {item.scripture_ref ? (
          <p className="mt-1 text-xs text-emerald-300/80">{item.scripture_ref}</p>
        ) : null}
        {item.notes ? <p className="mt-1 text-xs text-ink-500">{item.notes}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs">
        <button onClick={() => setEditing(true)} className="text-ink-400 hover:text-gold-300">
          Edit
        </button>
        <button onClick={remove} disabled={pending} className="text-ink-500 hover:text-[color:var(--color-danger)] disabled:opacity-50">
          Delete
        </button>
      </div>
    </div>
  );
}

export function ServiceEditor({
  serviceId,
  items,
}: {
  serviceId: string;
  items: ServiceItemRow[];
}) {
  const total = items.reduce((sum, i) => sum + i.duration_min, 0);
  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-ink-500">
          No items yet. Add the first part of the service below.
        </p>
      ) : (
        items.map((item, i) => (
          <ItemRow key={item.id} serviceId={serviceId} item={item} index={i} count={items.length} />
        ))
      )}
      {items.length > 0 ? (
        <p className="px-1 text-right text-xs text-ink-500">
          Total planned: <span className="text-ink-300">{total} min</span>
        </p>
      ) : null}
      <AddItemForm serviceId={serviceId} />
    </div>
  );
}
