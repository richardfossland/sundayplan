"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { fromLocalInput, toLocalInput, addMinutesLocal } from "@/lib/calendar";
import type { ResourceKind } from "@/src/types/booking";

export interface PublicResource {
  id: string;
  name: string;
  kind: ResourceKind;
  description: string | null;
  capacity: number | null;
  requires_approval: boolean;
}

export interface PublicEventType {
  id: string;
  name: string;
  default_duration_min: number;
  requires_approval: boolean;
  terms: string | null;
}

interface FreeSlot {
  start: string;
  end: string;
}

/**
 * Public rental request form. POSTs to /api/public/:slug/rentals. On success it
 * redirects the renter to their status link (/r/<token>). For `person`
 * resources it shows a Calendly-style slot picker fed by /api/public/:slug/slots.
 */
export function RentalForm({
  churchSlug,
  resources,
  eventTypes,
}: {
  churchSlug: string;
  resources: PublicResource[];
  eventTypes: PublicEventType[];
}) {
  const t = useT();

  const [resourceId, setResourceId] = useState(resources[0]?.id ?? "");
  const [eventTypeId, setEventTypeId] = useState("");
  const [renterName, setRenterName] = useState("");
  const [renterContact, setRenterContact] = useState("");
  const [purpose, setPurpose] = useState("");
  const [start, setStart] = useState(toLocalInput(Date.now() + 24 * 60 * 60 * 1000));
  const [end, setEnd] = useState(toLocalInput(Date.now() + 25 * 60 * 60 * 1000));

  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [pickedSlot, setPickedSlot] = useState<FreeSlot | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const resource = useMemo(
    () => resources.find((r) => r.id === resourceId) ?? null,
    [resources, resourceId],
  );
  const isPerson = resource?.kind === "person";
  const requiresApproval =
    resource?.requires_approval ||
    eventTypes.find((e) => e.id === eventTypeId)?.requires_approval ||
    !eventTypeId;
  const terms = eventTypes.find((e) => e.id === eventTypeId)?.terms ?? null;

  // When an event type is picked, set the duration.
  useEffect(() => {
    if (!eventTypeId) return;
    const et = eventTypes.find((e) => e.id === eventTypeId);
    if (et) setEnd(addMinutesLocal(start, et.default_duration_min));
  }, [eventTypeId, eventTypes, start]);

  // Fetch free slots when a person resource is selected.
  useEffect(() => {
    if (!isPerson || !resourceId) {
      setSlots([]);
      setPickedSlot(null);
      return;
    }
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const ctrl = new AbortController();
    fetch(
      `/api/public/${encodeURIComponent(churchSlug)}/slots?resourceId=${encodeURIComponent(
        resourceId,
      )}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&slot=30`,
      { signal: ctrl.signal },
    )
      .then((r) => (r.ok ? r.json() : { slots: [] }))
      .then((d: { slots?: FreeSlot[] }) => setSlots(d.slots ?? []))
      .catch(() => setSlots([]));
    return () => ctrl.abort();
  }, [isPerson, resourceId, churchSlug]);

  async function submit() {
    setError(null);
    setConflict(false);
    if (!resourceId) return setError(t("rental.err.resource"));
    if (!renterName.trim()) return setError(t("rental.err.name"));
    if (!renterContact.trim()) return setError(t("rental.err.contact"));

    const startsIso = isPerson && pickedSlot ? pickedSlot.start : fromLocalInput(start);
    const endsIso = isPerson && pickedSlot ? pickedSlot.end : fromLocalInput(end);
    if (isPerson && !pickedSlot) return setError(t("rental.err.slot"));

    setBusy(true);
    try {
      const res = await fetch(`/api/public/${encodeURIComponent(churchSlug)}/rentals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resourceId,
          eventTypeId: eventTypeId || null,
          renterName: renterName.trim(),
          renterContact: renterContact.trim(),
          purpose: purpose.trim() || null,
          starts: startsIso,
          ends: endsIso,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        statusUrl?: string | null;
        conflicts?: unknown;
      };
      if (res.ok && data.ok) {
        if (data.statusUrl) {
          window.location.href = data.statusUrl;
        } else {
          setError(t("rental.submitted"));
        }
        return;
      }
      if (res.status === 409) {
        setConflict(true);
        return;
      }
      setError(t("rental.err.generic"));
    } catch {
      setError(t("rental.err.generic"));
    } finally {
      setBusy(false);
    }
  }

  if (resources.length === 0) {
    return (
      <Card className="px-5 py-8 text-center">
        <p className="text-sm text-ink-400">{t("rental.noResources")}</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold text-ink-50">{t("rental.title")}</h1>
      <p className="mt-1 text-sm text-ink-400">{t("rental.subtitle")}</p>

      <div className="mt-5 space-y-3">
        <Field label={t("rental.field.resource")}>
          <Select value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>

        {eventTypes.length > 0 ? (
          <Field label={t("rental.field.purposeType")}>
            <Select value={eventTypeId} onChange={(e) => setEventTypeId(e.target.value)}>
              <option value="">{t("form.field.none")}</option>
              {eventTypes.map((et) => (
                <option key={et.id} value={et.id}>
                  {et.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {isPerson ? (
          <Field label={t("rental.field.slot")}>
            {slots.length === 0 ? (
              <p className="text-xs text-ink-500">{t("rental.noSlots")}</p>
            ) : (
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-white/10 bg-ink-950/40 p-2">
                {slots.map((s) => {
                  const on = pickedSlot?.start === s.start;
                  return (
                    <button
                      key={s.start}
                      type="button"
                      onClick={() => setPickedSlot(s)}
                      className={
                        "rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition " +
                        (on
                          ? "bg-royal-500/30 text-ink-50 ring-royal-400/50"
                          : "bg-white/[0.04] text-ink-300 ring-white/10 hover:text-ink-100")
                      }
                    >
                      {fmtSlot(s.start)}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("form.field.start")}>
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label={t("form.field.end")}>
              <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
        )}

        <Field label={t("rental.field.name")}>
          <Input value={renterName} onChange={(e) => setRenterName(e.target.value)} />
        </Field>
        <Field label={t("rental.field.contact")} hint={t("rental.field.contactHint")}>
          <Input value={renterContact} onChange={(e) => setRenterContact(e.target.value)} />
        </Field>
        <Field label={t("rental.field.purpose")}>
          <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </Field>

        <div className="rounded-lg border border-white/[0.06] bg-ink-950/40 px-3 py-2">
          <Badge tone={requiresApproval ? "warning" : "success"}>
            {requiresApproval ? t("rental.willPend") : t("rental.willConfirm")}
          </Badge>
        </div>

        {terms ? (
          <div className="rounded-lg border border-white/[0.06] bg-ink-950/40 px-3 py-2">
            <p className="text-xs font-medium text-ink-300">{t("renter.terms")}</p>
            <p className="mt-1 whitespace-pre-wrap text-xs text-ink-500">{terms}</p>
          </div>
        ) : null}

        {conflict ? (
          <p className="text-sm text-[color:var(--color-warning)]">{t("rental.err.conflict")}</p>
        ) : null}
        {error ? <p className="text-sm text-[color:var(--color-danger)]">{error}</p> : null}

        <Button type="button" onClick={submit} disabled={busy} className="w-full">
          {busy ? t("form.submitting") : t("rental.submit")}
        </Button>
      </div>
    </Card>
  );
}

function fmtSlot(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )}`;
}
