"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import {
  addMinutesLocal,
  alternativesToChips,
  conflictWindows,
  fromLocalInput,
  resourceNameLookup,
  toLocalInput,
} from "@/lib/calendar";
import { useSlotPresence } from "@/lib/realtime";
import type {
  EventType,
  RequestBookingResult,
  Resource,
} from "@/src/types/booking";
import type { BundleLite } from "@/components/calendar";
import type { BookingProposal } from "@/lib/nl-booking";

/** The proposal shape returned by /api/bookings/parse (client-safe subset). */
type NlProposal = BookingProposal;

export interface BookingFormSeed {
  /** Local datetime-local start string (prefilled from the clicked slot). */
  start: string;
  /** Local datetime-local end string. */
  end: string;
  /** Pre-selected resource (from a filtered column), if any. */
  resourceId?: string | null;
}

/**
 * Create-booking form. POSTs to /api/bookings; on 409 it renders the returned
 * conflicts + suggested alternatives as clickable chips that refill the form.
 * On success it calls onCreated() so the parent can optimistically refetch.
 *
 * While open it broadcasts Presence on the (resource, day) channel so other
 * planners viewing that slot see a hint badge.
 */
export function BookingForm({
  seed,
  resources,
  eventTypes,
  bundles,
  userId,
  onClose,
  onCreated,
}: {
  seed: BookingFormSeed;
  resources: Resource[];
  eventTypes: EventType[];
  bundles: BundleLite[];
  userId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useT();
  const nameOf = useMemo(() => resourceNameLookup(resources), [resources]);

  const [mode, setMode] = useState<"resources" | "bundle">("resources");
  const [title, setTitle] = useState("");
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>(
    seed.resourceId ? [seed.resourceId] : resources[0] ? [resources[0].id] : [],
  );
  const [bundleId, setBundleId] = useState<string>(bundles[0]?.id ?? "");
  const [eventTypeId, setEventTypeId] = useState<string>("");
  const [start, setStart] = useState(seed.start);
  const [end, setEnd] = useState(seed.end);
  const [setupMin, setSetupMin] = useState(0);
  const [teardownMin, setTeardownMin] = useState(0);
  const [notes, setNotes] = useState("");

  const [showOnSignage, setShowOnSignage] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RequestBookingResult | null>(null);
  const [peers, setPeers] = useState(0);

  // ── Natural-language prompt bar (Phase 4). Hidden when AI is unavailable
  // (no key / no consent / quota) — the manual form below always works. The
  // model only PROPOSES; this pre-fills fields and the planner confirms.
  const [nlPrompt, setNlPrompt] = useState("");
  const [nlBusy, setNlBusy] = useState(false);
  const [nlState, setNlState] = useState<
    | { kind: "idle" }
    | { kind: "unavailable"; reason: string }
    | { kind: "applied"; unresolved: string[] }
    | { kind: "error"; msg: string }
  >({ kind: "idle" });

  async function runNlParse() {
    if (!nlPrompt.trim()) return;
    setNlBusy(true);
    setNlState({ kind: "idle" });
    try {
      const res = await fetch("/api/bookings/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: nlPrompt.trim() }),
      });
      const data = (await res.json()) as {
        available?: boolean;
        reason?: string;
        error?: string;
        proposal?: NlProposal;
      };
      if (data.available === false) {
        setNlState({ kind: "unavailable", reason: data.reason ?? "no_key" });
        return;
      }
      if (res.status === 429) {
        setNlState({ kind: "unavailable", reason: "quota_exceeded" });
        return;
      }
      if (!res.ok || !data.proposal) {
        setNlState({ kind: "error", msg: t("nl.error") });
        return;
      }
      applyProposal(data.proposal);
      setNlState({ kind: "applied", unresolved: data.proposal.unresolved ?? [] });
    } catch {
      setNlState({ kind: "error", msg: t("nl.error") });
    } finally {
      setNlBusy(false);
    }
  }

  function applyProposal(p: NlProposal) {
    setMode("resources");
    if (p.title) setTitle(p.title);
    const ids = p.resources.map((r) => r.resourceId).filter((x): x is string => Boolean(x));
    if (ids.length > 0) setSelectedResourceIds(ids);
    if (p.eventTypeId) setEventTypeId(p.eventTypeId);
    if (p.start) setStart(p.start);
    if (p.end) setEnd(p.end);
  }

  // Presence on the primary resource + start day. Hints only.
  const presenceResource =
    mode === "bundle"
      ? bundles.find((b) => b.id === bundleId)?.primary_resource_id ?? null
      : selectedResourceIds[0] ?? null;
  const dayKey = start.slice(0, 10);
  useSlotPresence(presenceResource, dayKey, userId, setPeers);

  // When an event type is chosen, prefill buffers + duration from its defaults.
  useEffect(() => {
    if (!eventTypeId) return;
    const et = eventTypes.find((e) => e.id === eventTypeId);
    if (!et) return;
    setSetupMin(et.default_setup_min);
    setTeardownMin(et.default_teardown_min);
    setEnd((prev) => {
      // Keep duration = event-type default if the user hasn't widened it.
      const newEnd = addMinutesLocal(start, et.default_duration_min);
      return prev === seed.end ? newEnd : prev;
    });
  }, [eventTypeId, eventTypes, start, seed.end]);

  const chips = useMemo(
    () => alternativesToChips(result, nameOf),
    [result, nameOf],
  );
  const conflicts = useMemo(() => conflictWindows(result), [result]);

  function toggleResource(id: string) {
    setSelectedResourceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function submit() {
    setError(null);
    setResult(null);
    if (!title.trim()) {
      setError(t("form.error"));
      return;
    }
    if (mode === "resources" && selectedResourceIds.length === 0) {
      setError(t("form.needResource"));
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        eventTypeId: eventTypeId || null,
        starts: fromLocalInput(start),
        ends: fromLocalInput(end),
        setupMin,
        teardownMin,
        notes: notes || null,
        showOnSignage,
      };
      if (mode === "bundle") body.bundleId = bundleId;
      else body.resourceIds = selectedResourceIds;

      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as RequestBookingResult;
      if (res.ok && data.ok) {
        onCreated();
        return;
      }
      // 409 conflict (or generic) — surface alternatives.
      setResult(data);
      if (!("conflicts" in data) && !("alternatives" in data)) {
        setError(t("form.error"));
      }
    } catch {
      setError(t("form.error"));
    } finally {
      setBusy(false);
    }
  }

  function applyAlternative(resourceId: string, startsIso: string, endsIso: string) {
    setMode("resources");
    setSelectedResourceIds([resourceId]);
    setStart(toLocalInput(startsIso));
    setEnd(toLocalInput(endsIso));
    setResult(null);
    setError(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-ink-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-50">{t("form.book.title")}</h2>
          {peers > 0 ? <Badge tone="warning">{t("cal.presence")}</Badge> : null}
        </div>

        <div className="space-y-3">
          {/* Natural-language prompt bar (Phase 4). Pre-fills the form below. */}
          <div className="rounded-lg border border-royal-400/20 bg-royal-500/[0.06] p-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-royal-200">✨ {t("nl.label")}</span>
            </div>
            <div className="mt-1.5 flex gap-2">
              <Input
                value={nlPrompt}
                onChange={(e) => setNlPrompt(e.target.value)}
                placeholder={t("nl.placeholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runNlParse();
                  }
                }}
              />
              <Button type="button" variant="ghost" onClick={() => void runNlParse()} disabled={nlBusy}>
                {nlBusy ? t("nl.parsing") : t("nl.parse")}
              </Button>
            </div>
            {nlState.kind === "unavailable" ? (
              <p className="mt-1.5 text-[0.7rem] text-ink-500">{t("nl.unavailable")}</p>
            ) : null}
            {nlState.kind === "applied" ? (
              <p className="mt-1.5 text-[0.7rem] text-[color:var(--color-success)]">
                {t("nl.applied")}
                {nlState.unresolved.length > 0
                  ? ` · ${t("nl.unresolved")}: ${nlState.unresolved.join(", ")}`
                  : ""}
              </p>
            ) : null}
            {nlState.kind === "error" ? (
              <p className="mt-1.5 text-[0.7rem] text-[color:var(--color-danger)]">{nlState.msg}</p>
            ) : null}
          </div>

          <Field label={t("form.field.title")}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("form.field.titlePlaceholder")}
              autoFocus
            />
          </Field>

          <div className="flex gap-2">
            <Button
              variant={mode === "resources" ? "primary" : "ghost"}
              type="button"
              onClick={() => setMode("resources")}
            >
              {t("form.useResources")}
            </Button>
            {bundles.length > 0 ? (
              <Button
                variant={mode === "bundle" ? "primary" : "ghost"}
                type="button"
                onClick={() => setMode("bundle")}
              >
                {t("form.useBundle")}
              </Button>
            ) : null}
          </div>

          {mode === "resources" ? (
            <Field label={t("form.field.resource")}>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-white/10 bg-ink-950/40 p-2">
                {resources.map((r) => {
                  const on = selectedResourceIds.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggleResource(r.id)}
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
          ) : (
            <Field label={t("form.field.bundle")}>
              <Select value={bundleId} onChange={(e) => setBundleId(e.target.value)}>
                {bundles.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label={t("form.field.eventType")}>
            <Select value={eventTypeId} onChange={(e) => setEventTypeId(e.target.value)}>
              <option value="">{t("form.field.none")}</option>
              {eventTypes.map((et) => (
                <option key={et.id} value={et.id}>
                  {et.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("form.field.start")}>
              <Input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label={t("form.field.end")}>
              <Input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
            <Field label={t("form.field.setup")}>
              <Input
                type="number"
                min={0}
                value={setupMin}
                onChange={(e) => setSetupMin(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label={t("form.field.teardown")}>
              <Input
                type="number"
                min={0}
                value={teardownMin}
                onChange={(e) => setTeardownMin(Number(e.target.value) || 0)}
              />
            </Field>
          </div>

          <Field label={t("form.field.notes")}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          <label className="flex items-center gap-2 text-xs text-ink-300">
            <input
              type="checkbox"
              checked={showOnSignage}
              onChange={(e) => setShowOnSignage(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-white/20 bg-ink-950/60"
            />
            {t("form.field.signage")}
          </label>

          {result && !result.ok && (chips.length > 0 || conflicts.length > 0) ? (
            <div className="rounded-lg border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 p-3">
              <p className="text-sm font-medium text-[color:var(--color-warning)]">
                {t("form.conflict.title")}
              </p>
              <p className="mt-1 text-xs text-ink-400">{t("form.conflict.body")}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => applyAlternative(c.resourceId, c.starts, c.ends)}
                    className="rounded-full bg-royal-500/20 px-2.5 py-1 text-xs font-medium text-royal-100 ring-1 ring-inset ring-royal-400/40 hover:bg-royal-500/30"
                  >
                    {t("form.alt.apply")} {c.resourceName}: {fmtChip(c.starts)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="text-sm text-[color:var(--color-danger)]">{error}</p>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose}>
            {t("form.cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={busy}>
            {busy ? t("form.submitting") : t("form.submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function fmtChip(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
