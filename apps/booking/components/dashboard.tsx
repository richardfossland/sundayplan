"use client";

import { useMemo, useState } from "react";
import { Badge, Card } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import {
  occupancyByResource,
  busiestHours,
  summarize,
  type UtilBlock,
} from "@/lib/utilization";

/** Plain row shape passed from the server (epoch ms already parsed). */
export interface DashboardBlock {
  resourceId: string;
  startMs: number;
  endMs: number;
  isExternal: boolean;
}
export interface DashboardResource {
  id: string;
  name: string;
}
export interface UpcomingRental {
  id: string;
  title: string;
  starts_at_utc: string;
  renter_name: string | null;
}

const PERIODS: { key: "week" | "month" | "quarter"; days: number }[] = [
  { key: "week", days: 7 },
  { key: "month", days: 30 },
  { key: "quarter", days: 90 },
];

/**
 * Utilization dashboard (planner). Occupancy per resource, busiest hours, free
 * %, and upcoming external rentals. All math is the pure utilization core; the
 * bars are CSS — no chart dependency. The window is anchored at "now" passed
 * from the server so SSR + client agree.
 */
export function Dashboard({
  blocks,
  resources,
  rentals,
  nowMs,
  openHoursPerDay,
}: {
  blocks: DashboardBlock[];
  resources: DashboardResource[];
  rentals: UpcomingRental[];
  nowMs: number;
  openHoursPerDay: number;
}) {
  const t = useT();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("month");
  const days = PERIODS.find((p) => p.key === period)!.days;

  const nameOf = useMemo(
    () => new Map(resources.map((r) => [r.id, r.name])),
    [resources],
  );

  const fromMs = nowMs;
  const toMs = nowMs + days * 86_400_000;

  const util: UtilBlock[] = useMemo(
    () =>
      blocks.map((b) => ({
        resourceId: b.resourceId,
        startMs: b.startMs,
        endMs: b.endMs,
        isExternal: b.isExternal,
      })),
    [blocks],
  );

  const occ = useMemo(
    () =>
      occupancyByResource({
        blocks: util,
        resourceIds: resources.map((r) => r.id),
        fromMs,
        toMs,
        openHoursPerDay,
      }).sort((a, b) => b.occupancyPct - a.occupancyPct),
    [util, resources, fromMs, toMs, openHoursPerDay],
  );

  const hours = useMemo(() => busiestHours(util, fromMs, toMs), [util, fromMs, toMs]);
  const peakHourVal = Math.max(1, ...hours);
  const summary = useMemo(() => summarize(occ, util, fromMs, toMs), [occ, util, fromMs, toMs]);

  return (
    <div className="space-y-6">
      {/* Period switch */}
      <div className="flex items-center gap-1 rounded-lg bg-white/[0.05] p-0.5 w-fit">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            className={
              "rounded-md px-3 py-1.5 text-sm font-medium transition " +
              (period === p.key
                ? "bg-royal-500/30 text-ink-50"
                : "text-ink-400 hover:text-ink-200")
            }
          >
            {t(`dash.period.${p.key}`)}
          </button>
        ))}
      </div>

      {/* Headline cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={t("dash.avgOccupancy")} value={`${summary.avgOccupancyPct}%`} />
        <Stat label={t("dash.bookedHours")} value={`${summary.totalBookedHours}`} />
        <Stat
          label={t("dash.peakHour")}
          value={summary.peakHour === null ? "–" : `${String(summary.peakHour).padStart(2, "0")}:00`}
        />
        <Stat label={t("dash.externalRentals")} value={`${summary.externalCount}`} />
      </div>

      {/* Occupancy per resource */}
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-100">{t("dash.occupancyByResource")}</h2>
        {occ.length === 0 ? (
          <p className="text-sm text-ink-500">{t("dash.empty")}</p>
        ) : (
          <ul className="space-y-2.5">
            {occ.map((o) => (
              <li key={o.resourceId}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-ink-200">{nameOf.get(o.resourceId) ?? o.resourceId}</span>
                  <span className="text-ink-500">
                    {o.bookedHours}t · {o.occupancyPct}% ({o.freePct}% {t("dash.free")})
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-royal-500 to-royal-400"
                    style={{ width: `${o.occupancyPct}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Busiest hours */}
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-100">{t("dash.busiestHours")}</h2>
        <div className="flex items-end gap-0.5" style={{ height: 96 }}>
          {hours.map((h, i) => (
            <div key={i} className="flex flex-1 flex-col items-center justify-end" title={`${i}:00 — ${h}t`}>
              <div
                className="w-full rounded-t bg-gold-400/70"
                style={{ height: `${(h / peakHourVal) * 100}%`, minHeight: h > 0 ? 2 : 0 }}
              />
              {i % 3 === 0 ? (
                <span className="mt-1 text-[0.55rem] text-ink-600">{String(i).padStart(2, "0")}</span>
              ) : (
                <span className="mt-1 text-[0.55rem] text-transparent">.</span>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Upcoming external rentals */}
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-100">{t("dash.upcomingRentals")}</h2>
        {rentals.length === 0 ? (
          <p className="text-sm text-ink-500">{t("dash.noRentals")}</p>
        ) : (
          <ul className="space-y-2">
            {rentals.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2">
                <div>
                  <span className="text-sm text-ink-100">{r.title}</span>
                  {r.renter_name ? (
                    <span className="ml-2 text-xs text-ink-500">{r.renter_name}</span>
                  ) : null}
                </div>
                <Badge tone="gold">{fmt(r.starts_at_utc)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-2xl font-semibold text-ink-50">{value}</div>
      <div className="mt-0.5 text-xs text-ink-400">{label}</div>
    </Card>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
