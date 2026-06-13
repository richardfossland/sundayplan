"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { STATUS_TONE } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { addMinutesLocal, fromLocalInput, toLocalInput } from "@/lib/calendar";
import type { Booking, Resource } from "@/src/types/booking";

interface SimpleEventType {
  id: string;
  name: string;
  default_duration_min: number;
  requires_approval: boolean;
}

interface FreeSlot {
  start: string;
  end: string;
}

/**
 * Member-facing booking request: pick a member-/public-bookable resource + time
 * (or appointment slot for person resources), submit → POST /api/bookings. Shows
 * the member their own request history with live status, and flags up-front
 * whether the request will be confirmed immediately or wait for approval.
 */
export function MemberRequest({
  resources,
  eventTypes,
  myRequests,
}: {
  resources: Resource[];
  eventTypes: SimpleEventType[];
  myRequests: Booking[];
}) {
  const t = useT();

  const [resourceId, setResourceId] = useState(resources[0]?.id ?? "");
  const [eventTypeId, setEventTypeId] = useState("");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(toLocalInput(Date.now() + 24 * 60 * 60 * 1000));
  const [end, setEnd] = useState(toLocalInput(Date.now() + 25 * 60 * 60 * 1000));
  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [pickedSlot, setPickedSlot] = useState<FreeSlot | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [done, setDone] = useState<"pending" | "approved" | null>(null);
  const [requests, setRequests] = useState<Booking[]>(myRequests);

  const resource = useMemo(
    () => resources.find((r) => r.id === resourceId) ?? null,
    [resources, resourceId],
  );
  const isPerson = resource?.kind === "person";
  const willPend =
    resource?.requires_approval ||
    eventTypes.find((e) => e.id === eventTypeId)?.requires_approval ||
    !eventTypeId;

  useEffect(() => {
    if (!eventTypeId) return;
    const et = eventTypes.find((e) => e.id === eventTypeId);
    if (et) setEnd(addMinutesLocal(start, et.default_duration_min));
  }, [eventTypeId, eventTypes, start]);

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
      `/api/slots?resourceId=${encodeURIComponent(resourceId)}&from=${encodeURIComponent(
        from,
      )}&to=${encodeURIComponent(to)}&slot=30`,
      { signal: ctrl.signal },
    )
      .then((r) => (r.ok ? r.json() : { slots: [] }))
      .then((d: { slots?: FreeSlot[] }) => setSlots(d.slots ?? []))
      .catch(() => setSlots([]));
    return () => ctrl.abort();
  }, [isPerson, resourceId]);

  async function submit() {
    setError(null);
    setConflict(false);
    setDone(null);
    if (!resourceId) return setError(t("form.needResource"));
    if (!title.trim()) return setError(t("form.error"));
    if (isPerson && !pickedSlot) return setError(t("rental.err.slot"));

    const startsIso = isPerson && pickedSlot ? pickedSlot.start : fromLocalInput(start);
    const endsIso = isPerson && pickedSlot ? pickedSlot.end : fromLocalInput(end);

    setBusy(true);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          resourceIds: [resourceId],
          eventTypeId: eventTypeId || null,
          starts: startsIso,
          ends: endsIso,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        status?: "pending" | "approved";
        id?: string;
        booking_id?: string;
      };
      if (res.ok && data.ok) {
        setDone(data.status === "approved" ? "approved" : "pending");
        setTitle("");
        // Optimistically prepend to the history list.
        const newRow = {
          id: data.booking_id ?? Math.random().toString(36),
          title: title.trim(),
          starts_at_utc: startsIso,
          ends_at_utc: endsIso,
          status: (data.status ?? "pending") as Booking["status"],
        } as Booking;
        setRequests((prev) => [newRow, ...prev]);
        return;
      }
      if (res.status === 409) return setConflict(true);
      setError(t("form.error"));
    } catch {
      setError(t("form.error"));
    } finally {
      setBusy(false);
    }
  }

  if (resources.length === 0) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-ink-50">{t("request.title")}</h1>
        <p className="mt-4 text-sm text-ink-400">{t("request.noResources")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card className="p-6">
        <h1 className="text-xl font-semibold text-ink-50">{t("request.title")}</h1>
        <p className="mt-1 text-sm text-ink-400">{t("request.subtitle")}</p>

        <div className="mt-5 space-y-3">
          <Field label={t("form.field.title")}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("form.field.titlePlaceholder")}
            />
          </Field>
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
          ) : null}

          {isPerson ? (
            <Field label={t("rental.field.slot")}>
              {slots.length === 0 ? (
                <p className="text-xs text-ink-500">{t("rental.noSlots")}</p>
              ) : (
                <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-white/10 bg-ink-950/40 p-2">
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

          <div className="rounded-lg border border-white/[0.06] bg-ink-950/40 px-3 py-2">
            <Badge tone={willPend ? "warning" : "success"}>
              {willPend ? t("request.willPend") : t("request.willConfirm")}
            </Badge>
          </div>

          {conflict ? (
            <p className="text-sm text-[color:var(--color-warning)]">{t("rental.err.conflict")}</p>
          ) : null}
          {done ? (
            <p className="text-sm text-[color:var(--color-success)]">
              {done === "approved" ? t("request.confirmed") : t("request.pendingSent")}
            </p>
          ) : null}
          {error ? <p className="text-sm text-[color:var(--color-danger)]">{error}</p> : null}

          <Button type="button" onClick={submit} disabled={busy} className="w-full">
            {busy ? t("form.submitting") : t("form.submit")}
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-ink-100">{t("request.mine")}</h2>
        {requests.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">{t("request.mineEmpty")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {requests.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-ink-950/40 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-ink-100">{b.title}</p>
                  <p className="text-xs text-ink-500">{fmtWhen(b.starts_at_utc)}</p>
                </div>
                <Badge tone={STATUS_TONE[b.status] ?? "neutral"}>{t(`status.${b.status}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function fmtSlot(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )}`;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}
