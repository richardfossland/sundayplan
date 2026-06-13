"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import type {
  Availability,
  BookableBy,
  EventType,
  Resource,
  ResourceKind,
} from "@/src/types/booking";

export interface BundleView {
  id: string;
  church_id: string;
  name: string;
  primary_resource_id: string;
  item_resource_ids: string[];
}

const KINDS: ResourceKind[] = ["room", "equipment", "person", "vehicle"];
const BOOKABLE: BookableBy[] = ["staff", "members", "public"];

type Tab = "resources" | "eventTypes" | "bundles";

export function ResourceAdmin({
  initialResources,
  initialEventTypes,
  initialBundles,
}: {
  initialResources: Resource[];
  initialEventTypes: EventType[];
  initialBundles: BundleView[];
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("resources");
  const [resources, setResources] = useState(initialResources);
  const [eventTypes, setEventTypes] = useState(initialEventTypes);
  const [bundles, setBundles] = useState(initialBundles);

  return (
    <div>
      <div className="mb-5 flex gap-1 rounded-lg bg-white/[0.05] p-0.5">
        {(
          [
            ["resources", "res.tab.resources"],
            ["eventTypes", "res.tab.eventTypes"],
            ["bundles", "res.tab.bundles"],
          ] as [Tab, string][]
        ).map(([id, key]) => (
          <Button
            key={id}
            variant={tab === id ? "primary" : "subtle"}
            onClick={() => setTab(id)}
          >
            {t(key)}
          </Button>
        ))}
      </div>

      {tab === "resources" ? (
        <ResourcesTab resources={resources} setResources={setResources} />
      ) : tab === "eventTypes" ? (
        <EventTypesTab eventTypes={eventTypes} setEventTypes={setEventTypes} />
      ) : (
        <BundlesTab
          bundles={bundles}
          setBundles={setBundles}
          resources={resources}
        />
      )}
    </div>
  );
}

// ── Resources tab ─────────────────────────────────────────────────────────────

const EMPTY_RES = {
  kind: "room" as ResourceKind,
  name: "",
  description: "",
  capacity: "",
  site: "",
  color: "#6366f1",
  defaultSetupMin: 0,
  defaultTeardownMin: 0,
  bookableBy: "staff" as BookableBy,
  requiresApproval: true,
};

function ResourcesTab({
  resources,
  setResources,
}: {
  resources: Resource[];
  setResources: (r: Resource[]) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(EMPTY_RES);
  const [busy, setBusy] = useState(false);

  function startNew() {
    setForm(EMPTY_RES);
    setEditing("new");
  }
  function startEdit(r: Resource) {
    setForm({
      kind: r.kind,
      name: r.name,
      description: r.description ?? "",
      capacity: r.capacity != null ? String(r.capacity) : "",
      site: r.site ?? "",
      color: r.color ?? "#6366f1",
      defaultSetupMin: r.default_setup_min,
      defaultTeardownMin: r.default_teardown_min,
      bookableBy: r.bookable_by,
      requiresApproval: r.requires_approval,
    });
    setEditing(r.id);
  }

  async function save() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        kind: form.kind,
        name: form.name.trim(),
        description: form.description || null,
        capacity: form.capacity ? Number(form.capacity) : null,
        site: form.site || null,
        color: form.color,
        defaultSetupMin: form.defaultSetupMin,
        defaultTeardownMin: form.defaultTeardownMin,
        bookableBy: form.bookableBy,
        requiresApproval: form.requiresApproval,
      };
      let res: Response;
      if (editing === "new") {
        res = await fetch("/api/resources", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/resources", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: editing, ...payload }),
        });
      }
      if (!res.ok) return;
      const { resource } = (await res.json()) as { resource: Resource };
      setResources(
        editing === "new"
          ? [...resources, resource].sort((a, b) => a.name.localeCompare(b.name))
          : resources.map((r) => (r.id === resource.id ? resource : r)),
      );
      setEditing(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={startNew}>{t("res.new")}</Button>
      </div>

      {editing ? (
        <Card className="p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("res.field.name")}>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t("res.field.kind")}>
              <Select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as ResourceKind })}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`res.kind.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("res.field.site")}>
              <Input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} />
            </Field>
            <Field label={t("res.field.capacity")}>
              <Input
                type="number"
                value={form.capacity}
                onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              />
            </Field>
            <Field label={t("res.field.setup")}>
              <Input
                type="number"
                value={form.defaultSetupMin}
                onChange={(e) => setForm({ ...form, defaultSetupMin: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label={t("res.field.teardown")}>
              <Input
                type="number"
                value={form.defaultTeardownMin}
                onChange={(e) =>
                  setForm({ ...form, defaultTeardownMin: Number(e.target.value) || 0 })
                }
              />
            </Field>
            <Field label={t("res.field.bookableBy")}>
              <Select
                value={form.bookableBy}
                onChange={(e) => setForm({ ...form, bookableBy: e.target.value as BookableBy })}
              >
                {BOOKABLE.map((b) => (
                  <option key={b} value={b}>
                    {t(`res.bookable.${b}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("res.field.color")}>
              <Input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="h-9 p-1"
              />
            </Field>
            <Field label={t("res.field.description")}>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 self-end text-sm text-ink-300">
              <input
                type="checkbox"
                checked={form.requiresApproval}
                onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })}
              />
              {t("res.field.requiresApproval")}
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t("form.cancel")}
            </Button>
            <Button onClick={save} disabled={busy || !form.name.trim()}>
              {busy ? t("res.saving") : t("res.save")}
            </Button>
          </div>
        </Card>
      ) : null}

      {resources.length === 0 ? (
        <p className="text-sm text-ink-500">{t("res.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {resources.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-white/[0.07] bg-ink-900/50 px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ background: r.color ?? "#6366f1" }}
                  />
                  <div>
                    <span className="font-medium text-ink-100">{r.name}</span>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-500">
                      <span>{t(`res.kind.${r.kind}`)}</span>
                      {r.site ? <span>· {r.site}</span> : null}
                      {r.requires_approval ? <Badge tone="gold">⚑</Badge> : null}
                    </div>
                  </div>
                </div>
                <Button variant="ghost" onClick={() => startEdit(r)}>
                  {t("res.edit")}
                </Button>
              </div>
              {r.kind === "person" ? <AvailabilityEditor resourceId={r.id} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Event types tab ───────────────────────────────────────────────────────────

const EMPTY_ET = {
  name: "",
  defaultDurationMin: 60,
  defaultSetupMin: 0,
  defaultTeardownMin: 0,
  color: "#22c55e",
  requiresApproval: true,
  terms: "",
};

function EventTypesTab({
  eventTypes,
  setEventTypes,
}: {
  eventTypes: EventType[];
  setEventTypes: (e: EventType[]) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(EMPTY_ET);
  const [busy, setBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);

  async function seed() {
    setSeeding(true);
    try {
      const res = await fetch("/api/event-types", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seedDefaults: true }),
      });
      if (!res.ok) return;
      const { eventTypes: list } = (await res.json()) as { eventTypes: EventType[] };
      setEventTypes(list);
    } finally {
      setSeeding(false);
    }
  }

  function startEdit(et: EventType) {
    setForm({
      name: et.name,
      defaultDurationMin: et.default_duration_min,
      defaultSetupMin: et.default_setup_min,
      defaultTeardownMin: et.default_teardown_min,
      color: et.color ?? "#22c55e",
      requiresApproval: et.requires_approval,
      terms: et.terms ?? "",
    });
    setEditing(et.id);
  }

  async function save() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        defaultDurationMin: form.defaultDurationMin,
        defaultSetupMin: form.defaultSetupMin,
        defaultTeardownMin: form.defaultTeardownMin,
        color: form.color,
        requiresApproval: form.requiresApproval,
        terms: form.terms || null,
      };
      const res =
        editing === "new"
          ? await fetch("/api/event-types", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch("/api/event-types", {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id: editing, ...payload }),
            });
      if (!res.ok) return;
      const { eventType } = (await res.json()) as { eventType: EventType };
      setEventTypes(
        editing === "new"
          ? [...eventTypes, eventType].sort((a, b) => a.name.localeCompare(b.name))
          : eventTypes.map((e) => (e.id === eventType.id ? eventType : e)),
      );
      setEditing(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={seed} disabled={seeding}>
          {seeding ? t("et.seeding") : t("et.seed")}
        </Button>
        <Button
          onClick={() => {
            setForm(EMPTY_ET);
            setEditing("new");
          }}
        >
          {t("et.new")}
        </Button>
      </div>

      {editing ? (
        <Card className="p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("et.field.name")}>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t("et.field.duration")}>
              <Input
                type="number"
                value={form.defaultDurationMin}
                onChange={(e) =>
                  setForm({ ...form, defaultDurationMin: Number(e.target.value) || 0 })
                }
              />
            </Field>
            <Field label={t("et.field.setup")}>
              <Input
                type="number"
                value={form.defaultSetupMin}
                onChange={(e) => setForm({ ...form, defaultSetupMin: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label={t("et.field.teardown")}>
              <Input
                type="number"
                value={form.defaultTeardownMin}
                onChange={(e) =>
                  setForm({ ...form, defaultTeardownMin: Number(e.target.value) || 0 })
                }
              />
            </Field>
            <Field label={t("et.field.color")}>
              <Input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="h-9 p-1"
              />
            </Field>
            <Field label={t("et.field.terms")}>
              <Input value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 self-end text-sm text-ink-300">
              <input
                type="checkbox"
                checked={form.requiresApproval}
                onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })}
              />
              {t("et.field.requiresApproval")}
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t("form.cancel")}
            </Button>
            <Button onClick={save} disabled={busy || !form.name.trim()}>
              {busy ? t("res.saving") : t("res.save")}
            </Button>
          </div>
        </Card>
      ) : null}

      {eventTypes.length === 0 ? (
        <p className="text-sm text-ink-500">{t("et.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {eventTypes.map((et) => (
            <li
              key={et.id}
              className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-ink-900/50 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ background: et.color ?? "#22c55e" }}
                />
                <div>
                  <span className="font-medium text-ink-100">{et.name}</span>
                  <div className="mt-0.5 text-xs text-ink-500">
                    {et.default_duration_min} min · +{et.default_setup_min}/{et.default_teardown_min}
                    {et.requires_approval ? " · ⚑" : ""}
                  </div>
                </div>
              </div>
              <Button variant="ghost" onClick={() => startEdit(et)}>
                {t("res.edit")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Bundles tab ───────────────────────────────────────────────────────────────

function BundlesTab({
  bundles,
  setBundles,
  resources,
}: {
  bundles: BundleView[];
  setBundles: (b: BundleView[]) => void;
  resources: Resource[];
}) {
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [primary, setPrimary] = useState(resources[0]?.id ?? "");
  const [items, setItems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const nameOf = (id: string) => resources.find((r) => r.id === id)?.name ?? id;

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/bundles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          primaryResourceId: primary,
          itemResourceIds: items,
        }),
      });
      if (!res.ok) return;
      const { bundle } = (await res.json()) as { bundle: BundleView };
      setBundles([...bundles, bundle].sort((a, b) => a.name.localeCompare(b.name)));
      setCreating(false);
      setName("");
      setItems([]);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch("/api/bundles", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) setBundles(bundles.filter((b) => b.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating((v) => !v)}>{t("bundle.new")}</Button>
      </div>

      {creating ? (
        <Card className="p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("bundle.field.name")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("bundle.field.primary")}>
              <Select value={primary} onChange={(e) => setPrimary(e.target.value)}>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t("bundle.field.included")}>
            <div className="flex flex-wrap gap-1.5 rounded-lg border border-white/10 bg-ink-950/40 p-2">
              {resources
                .filter((r) => r.id !== primary)
                .map((r) => {
                  const on = items.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() =>
                        setItems((prev) =>
                          prev.includes(r.id)
                            ? prev.filter((x) => x !== r.id)
                            : [...prev, r.id],
                        )
                      }
                      className={
                        "rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition " +
                        (on
                          ? "bg-royal-500/30 text-ink-50 ring-royal-400/50"
                          : "bg-white/[0.04] text-ink-400 ring-white/10 hover:text-ink-200")
                      }
                    >
                      {r.name}
                    </button>
                  );
                })}
            </div>
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              {t("form.cancel")}
            </Button>
            <Button onClick={create} disabled={busy || !name.trim() || !primary}>
              {busy ? t("res.saving") : t("bundle.create")}
            </Button>
          </div>
        </Card>
      ) : null}

      {bundles.length === 0 ? (
        <p className="text-sm text-ink-500">{t("bundle.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {bundles.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-ink-900/50 px-4 py-3"
            >
              <div>
                <span className="font-medium text-ink-100">{b.name}</span>
                <div className="mt-0.5 text-xs text-ink-500">
                  {nameOf(b.primary_resource_id)}
                  {b.item_resource_ids.length > 0
                    ? ` · ${t("bundle.includes")} ${b.item_resource_ids.map(nameOf).join(", ")}`
                    : ""}
                </div>
              </div>
              <Button variant="danger" onClick={() => remove(b.id)}>
                {t("bundle.delete")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Availability windows (person resources) ────────────────────────────────────

const WEEKDAY_KEYS = [
  "avail.day.sun",
  "avail.day.mon",
  "avail.day.tue",
  "avail.day.wed",
  "avail.day.thu",
  "avail.day.fri",
  "avail.day.sat",
] as const;

/**
 * CRUD for a person resource's weekly bookable windows (used to derive
 * appointment slots). Minimal but typechecked: list + add + delete, scoped
 * server-side to the resource's church.
 */
function AvailabilityEditor({ resourceId }: { resourceId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [windows, setWindows] = useState<Availability[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [weekday, setWeekday] = useState(1);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    fetch(`/api/availability?resourceId=${encodeURIComponent(resourceId)}`)
      .then((r) => (r.ok ? r.json() : { windows: [] }))
      .then((d: { windows?: Availability[] }) => {
        setWindows(d.windows ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, loaded, resourceId]);

  async function add() {
    if (endTime <= startTime) return;
    setBusy(true);
    try {
      const res = await fetch("/api/availability", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceId, weekday, startTime, endTime }),
      });
      if (!res.ok) return;
      const { window } = (await res.json()) as { window: Availability };
      setWindows((prev) =>
        [...prev, window].sort(
          (a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time),
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch("/api/availability", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) setWindows((prev) => prev.filter((w) => w.id !== id));
  }

  return (
    <div className="mt-3 border-t border-white/[0.06] pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-royal-300 hover:text-royal-200"
      >
        {open ? t("avail.hide") : t("avail.manage")}
      </button>
      {open ? (
        <div className="mt-3 space-y-3">
          {windows.length === 0 ? (
            <p className="text-xs text-ink-500">{t("avail.empty")}</p>
          ) : (
            <ul className="space-y-1.5">
              {windows.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center justify-between rounded-md bg-ink-950/40 px-2.5 py-1.5 text-xs text-ink-300"
                >
                  <span>
                    {t(WEEKDAY_KEYS[w.weekday])} {w.start_time.slice(0, 5)}–{w.end_time.slice(0, 5)}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(w.id)}
                    className="text-[color:var(--color-danger)] hover:underline"
                  >
                    {t("bundle.delete")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-3 gap-2">
            <Field label={t("avail.weekday")}>
              <Select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAY_KEYS.map((k, i) => (
                  <option key={k} value={i}>
                    {t(k)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("avail.start")}>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label={t("avail.end")}>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </div>
          <Button onClick={add} disabled={busy || endTime <= startTime}>
            {t("avail.add")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
