"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { useBookingRealtime } from "@/lib/realtime";
import {
  addDays,
  blockIntersectsDay,
  bookingColor,
  effectiveBlock,
  monthGridDays,
  placeInDay,
  sameDay,
  toLocalInput,
  viewRange,
  weekDays,
  type CalendarView,
  type EffectiveBlock,
} from "@/lib/calendar";
import { BookingForm, type BookingFormSeed } from "@/components/booking-form";
import type {
  Booking,
  EventType,
  Resource,
} from "@/src/types/booking";

/** A lightweight bundle shape passed to the booking form (avoids importing
 * the server data type into the client). */
export interface BundleLite {
  id: string;
  name: string;
  primary_resource_id: string;
}

interface ServiceBlock {
  id: string;
  name: string;
  starts_at_utc: string;
  state: string;
}

interface CalendarData {
  bookings: Booking[];
  bookingResources: Record<string, string[]>;
  services: ServiceBlock[];
}

const WEEKDAY_KEYS = [
  "cal.weekday.mon",
  "cal.weekday.tue",
  "cal.weekday.wed",
  "cal.weekday.thu",
  "cal.weekday.fri",
  "cal.weekday.sat",
  "cal.weekday.sun",
];

/** Default block length (ms) the calendar paints for a SundayPlan service,
 * since public.service stores only a start time. */
const SERVICE_DURATION_MIN = 90;

export function Calendar({
  initial,
  resources,
  eventTypes,
  bundles,
  userId,
  isPlanner,
}: {
  initial: CalendarData;
  resources: Resource[];
  eventTypes: EventType[];
  bundles: BundleLite[];
  userId: string;
  isPlanner: boolean;
}) {
  const t = useT();
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [resourceFilter, setResourceFilter] = useState<string>("all");
  const [data, setData] = useState<CalendarData>(initial);
  const [formSeed, setFormSeed] = useState<BookingFormSeed | null>(null);

  const eventTypeColors = useMemo(
    () => Object.fromEntries(eventTypes.map((e) => [e.id, e.color])),
    [eventTypes],
  );
  const resourceColors = useMemo(
    () => Object.fromEntries(resources.map((r) => [r.id, r.color])),
    [resources],
  );

  const refetch = useCallback(async () => {
    const { from, to } = viewRange(view, anchor);
    try {
      const res = await fetch(
        `/api/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as CalendarData;
      setData(json);
    } catch {
      /* keep stale data on failure */
    }
  }, [view, anchor]);

  // Refetch whenever the visible window changes.
  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Realtime + visibility-regain refetch (hint layer; failures swallowed).
  useBookingRealtime(refetch);

  // Bookings visible after the resource filter, with their effective blocks.
  const visible = useMemo(() => {
    return data.bookings
      .filter((b) => {
        if (resourceFilter === "all") return true;
        return (data.bookingResources[b.id] ?? []).includes(resourceFilter);
      })
      .map((b) => ({
        booking: b,
        block: effectiveBlock(b),
        color: bookingColor(b, {
          eventTypeColors,
          resourceColors,
          primaryResourceId: (data.bookingResources[b.id] ?? [])[0] ?? null,
        }),
      }));
  }, [data, resourceFilter, eventTypeColors, resourceColors]);

  const serviceBlocks = useMemo(
    () =>
      data.services.map((s) => {
        const start = Date.parse(s.starts_at_utc);
        return {
          service: s,
          blockStart: start,
          blockEnd: start + SERVICE_DURATION_MIN * 60_000,
        };
      }),
    [data.services],
  );

  function shift(dir: -1 | 1) {
    setAnchor((a) => (view === "week" ? addDays(a, dir * 7) : addMonths(a, dir)));
  }

  function openSlot(day: Date, hour: number) {
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start);
    end.setHours(hour + 1);
    setFormSeed({
      start: toLocalInput(start),
      end: toLocalInput(end),
      resourceId: resourceFilter === "all" ? null : resourceFilter,
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-white/[0.05] p-0.5">
          <Button
            variant={view === "week" ? "primary" : "subtle"}
            onClick={() => setView("week")}
          >
            {t("cal.view.week")}
          </Button>
          <Button
            variant={view === "month" ? "primary" : "subtle"}
            onClick={() => setView("month")}
          >
            {t("cal.view.month")}
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" onClick={() => shift(-1)}>
            ‹
          </Button>
          <Button variant="ghost" onClick={() => setAnchor(new Date())}>
            {t("cal.today")}
          </Button>
          <Button variant="ghost" onClick={() => shift(1)}>
            ›
          </Button>
        </div>

        <span className="text-sm font-medium text-ink-200">{rangeLabel(view, anchor)}</span>

        <div className="ml-auto flex items-center gap-2">
          <Select
            value={resourceFilter}
            onChange={(e) => setResourceFilter(e.target.value)}
            className="w-48"
          >
            <option value="all">{t("cal.allResources")}</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          <Button
            onClick={() =>
              setFormSeed({
                start: toLocalInput(roundToNextHour(new Date())),
                end: toLocalInput(addHours(roundToNextHour(new Date()), 1)),
                resourceId: resourceFilter === "all" ? null : resourceFilter,
              })
            }
          >
            {t("cal.newBooking")}
          </Button>
        </div>
      </div>

      {view === "week" ? (
        <WeekView
          anchor={anchor}
          visible={visible}
          serviceBlocks={serviceBlocks}
          onSlot={openSlot}
        />
      ) : (
        <MonthView
          anchor={anchor}
          visible={visible}
          serviceBlocks={serviceBlocks}
          onDay={(d) => openSlot(d, 9)}
        />
      )}

      <Legend />

      {formSeed ? (
        <BookingForm
          seed={formSeed}
          resources={resources}
          eventTypes={eventTypes}
          bundles={bundles}
          userId={userId}
          onClose={() => setFormSeed(null)}
          onCreated={() => {
            setFormSeed(null);
            void refetch();
          }}
        />
      ) : null}

      {!isPlanner ? null : <span className="sr-only" data-planner />}
    </div>
  );
}

// ── Week view (time grid) ─────────────────────────────────────────────────────

interface VisibleBooking {
  booking: Booking;
  block: EffectiveBlock;
  color: string;
}
interface VisibleService {
  service: ServiceBlock;
  blockStart: number;
  blockEnd: number;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_HEIGHT = 1152; // px (24 * 48)

function WeekView({
  anchor,
  visible,
  serviceBlocks,
  onSlot,
}: {
  anchor: Date;
  visible: VisibleBooking[];
  serviceBlocks: VisibleService[];
  onSlot: (day: Date, hour: number) => void;
}) {
  const t = useT();
  const days = weekDays(anchor);

  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-ink-900/40">
      <div className="grid min-w-[760px] grid-cols-[48px_repeat(7,1fr)]">
        {/* Header row */}
        <div className="border-b border-white/[0.06]" />
        {days.map((d, i) => (
          <div
            key={i}
            className="border-b border-l border-white/[0.06] px-2 py-1.5 text-center"
          >
            <div className="text-[0.7rem] uppercase tracking-wide text-ink-500">
              {t(WEEKDAY_KEYS[i])}
            </div>
            <div
              className={
                "text-sm font-semibold " +
                (sameDay(d, new Date()) ? "text-gold-400" : "text-ink-200")
              }
            >
              {d.getDate()}
            </div>
          </div>
        ))}

        {/* Time gutter */}
        <div className="relative" style={{ height: DAY_HEIGHT }}>
          {HOURS.map((h) => (
            <div
              key={h}
              className="absolute left-0 right-0 -translate-y-1/2 pr-1 text-right text-[0.65rem] text-ink-600"
              style={{ top: (h / 24) * DAY_HEIGHT }}
            >
              {h > 0 ? `${String(h).padStart(2, "0")}:00` : ""}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((day, di) => (
          <div
            key={di}
            className="relative border-l border-white/[0.06]"
            style={{ height: DAY_HEIGHT }}
          >
            {/* Hour grid + click targets */}
            {HOURS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => onSlot(day, h)}
                title={t("cal.clickToBook")}
                className="absolute left-0 right-0 border-t border-white/[0.04] hover:bg-white/[0.03]"
                style={{ top: (h / 24) * DAY_HEIGHT, height: DAY_HEIGHT / 24 }}
              />
            ))}

            {/* Service overlays (read-only) */}
            {serviceBlocks
              .filter((s) =>
                blockIntersectsDay(
                  {
                    blockStart: s.blockStart,
                    blockEnd: s.blockEnd,
                  } as EffectiveBlock,
                  day,
                ),
              )
              .map((s) => {
                const p = placeInDay(s.blockStart, s.blockEnd, day);
                return (
                  <div
                    key={s.service.id}
                    className="pointer-events-none absolute left-0.5 right-0.5 rounded-md border border-dashed border-ink-400/40 bg-ink-400/10 px-1 py-0.5 text-[0.6rem] text-ink-400"
                    style={{
                      top: `${p.topPct}%`,
                      height: `${Math.max(p.heightPct, 2)}%`,
                    }}
                  >
                    ⛪ {s.service.name}
                  </div>
                );
              })}

            {/* Bookings: effective block with distinct buffer zones */}
            {visible
              .filter((v) => blockIntersectsDay(v.block, day))
              .map((v) => (
                <BookingChip key={v.booking.id} v={v} day={day} />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function BookingChip({ v, day }: { v: VisibleBooking; day: Date }) {
  const t = useT();
  const block = placeInDay(v.block.blockStart, v.block.blockEnd, day);
  const core = placeInDay(v.block.coreStart, v.block.coreEnd, day);
  const dimmed = v.booking.status !== "approved";
  return (
    <div
      className="absolute left-0.5 right-0.5 overflow-hidden rounded-md text-[0.62rem] text-ink-50 shadow"
      style={{
        top: `${block.topPct}%`,
        height: `${Math.max(block.heightPct, 2.2)}%`,
        // Buffer zone: a faint hatched border using the booking color.
        background: hexAlpha(v.color, dimmed ? 0.18 : 0.28),
        border: `1px solid ${hexAlpha(v.color, 0.55)}`,
      }}
      title={`${v.booking.title} (${v.booking.status})`}
    >
      {/* Core time = solid colored fill, distinct from the buffer. */}
      <div
        className="absolute left-0 right-0"
        style={{
          top: `${pctWithinBlock(block, core, "top")}%`,
          height: `${pctWithinBlock(block, core, "height")}%`,
          background: hexAlpha(v.color, dimmed ? 0.45 : 0.75),
        }}
      />
      <div className="relative px-1 py-0.5">
        <span className="font-medium">{v.booking.title}</span>
        {v.block.setupMin > 0 || v.block.teardownMin > 0 ? (
          <span className="ml-1 opacity-70">
            ·{v.block.setupMin > 0 ? ` +${v.block.setupMin}${t("cal.setup")[0]}` : ""}
            {v.block.teardownMin > 0 ? ` ${v.block.teardownMin}${t("cal.teardown")[0]}` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ── Month view ────────────────────────────────────────────────────────────────

function MonthView({
  anchor,
  visible,
  serviceBlocks,
  onDay,
}: {
  anchor: Date;
  visible: VisibleBooking[];
  serviceBlocks: VisibleService[];
  onDay: (day: Date) => void;
}) {
  const t = useT();
  const days = monthGridDays(anchor);
  const month = anchor.getMonth();

  return (
    <div className="rounded-xl border border-white/[0.07] bg-ink-900/40">
      <div className="grid grid-cols-7 border-b border-white/[0.06]">
        {WEEKDAY_KEYS.map((k) => (
          <div
            key={k}
            className="px-2 py-1.5 text-center text-[0.7rem] uppercase tracking-wide text-ink-500"
          >
            {t(k)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const dayBookings = visible.filter((v) => blockIntersectsDay(v.block, day));
          const dayServices = serviceBlocks.filter((s) =>
            blockIntersectsDay(
              { blockStart: s.blockStart, blockEnd: s.blockEnd } as EffectiveBlock,
              day,
            ),
          );
          const inMonth = day.getMonth() === month;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onDay(day)}
              className={
                "min-h-[92px] border-b border-l border-white/[0.05] p-1 text-left align-top transition hover:bg-white/[0.03] " +
                (inMonth ? "" : "opacity-40")
              }
            >
              <div
                className={
                  "mb-0.5 text-xs font-medium " +
                  (sameDay(day, new Date()) ? "text-gold-400" : "text-ink-300")
                }
              >
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayServices.slice(0, 1).map((s) => (
                  <div
                    key={s.service.id}
                    className="truncate rounded border border-dashed border-ink-400/40 bg-ink-400/10 px-1 text-[0.6rem] text-ink-400"
                  >
                    ⛪ {s.service.name}
                  </div>
                ))}
                {dayBookings.slice(0, 3).map((v) => (
                  <div
                    key={v.booking.id}
                    className="truncate rounded px-1 text-[0.6rem] text-ink-50"
                    style={{ background: hexAlpha(v.color, 0.55) }}
                  >
                    {v.booking.title}
                  </div>
                ))}
                {dayBookings.length > 3 ? (
                  <div className="px-1 text-[0.6rem] text-ink-500">
                    +{dayBookings.length - 3}
                  </div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Legend() {
  const t = useT();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4 text-[0.7rem] text-ink-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm bg-royal-500/75" /> {t("cal.view.week")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm bg-royal-500/25 ring-1 ring-inset ring-royal-400/50" />
        {t("cal.setup")} / {t("cal.teardown")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm border border-dashed border-ink-400/50 bg-ink-400/10" />
        {t("cal.serviceBlock")}
      </span>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

function pctWithinBlock(
  block: { topPct: number; heightPct: number },
  core: { topPct: number; heightPct: number },
  which: "top" | "height",
): number {
  if (block.heightPct <= 0) return which === "top" ? 0 : 100;
  if (which === "top") {
    return Math.max(0, ((core.topPct - block.topPct) / block.heightPct) * 100);
  }
  return Math.min(100, (core.heightPct / block.heightPct) * 100);
}

/** Apply an alpha to a #rrggbb (or any CSS color) by wrapping in color-mix. */
function hexAlpha(color: string | null | undefined, alpha: number): string {
  const c = color ?? "#6366f1";
  const pct = Math.round(alpha * 100);
  return `color-mix(in srgb, ${c} ${pct}%, transparent)`;
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}
function addHours(d: Date, n: number): Date {
  const x = new Date(d);
  x.setHours(x.getHours() + n);
  return x;
}
function roundToNextHour(d: Date): Date {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  x.setHours(x.getHours() + 1);
  return x;
}

function rangeLabel(view: CalendarView, anchor: Date): string {
  if (view === "week") {
    const days = weekDays(anchor);
    const a = days[0];
    const b = days[6];
    return `${a.getDate()}.${a.getMonth() + 1} – ${b.getDate()}.${b.getMonth() + 1}.${b.getFullYear()}`;
  }
  return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
