import Link from "next/link";
import {
  buildTonoReport,
  buildCcliReport,
  buildVolunteerBalance,
  buildServiceCoverage,
  buildChurnReport,
  buildRoleBalanceReport,
  quarterRange,
  rangeLabel,
} from "@sundayplan/sdk";
import { Badge, Card, SectionTitle, StatTile } from "@/components/ui";
import {
  VolunteerBalanceTable,
  ServiceCoverageTable,
  VolunteerHealthTable,
  RoleBalanceTable,
} from "@/components/reports-operational";
import {
  getSongUsageRows,
  getServeRows,
  getCoverageRows,
  getChurnInputs,
  getRoleBalanceInputs,
} from "@/lib/data/reports";
import { getChurchSettings } from "@/lib/data/settings";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

const input =
  "rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-400/50";

function dates(list: string[]): string {
  return list.join(", ");
}

type Tab = "licensing" | "balance" | "coverage" | "health" | "roleBalance";
const TAB_KEYS: Tab[] = ["licensing", "balance", "coverage", "health", "roleBalance"];
const TABS: { key: Tab; labelKey: string }[] = [
  { key: "licensing", labelKey: "reports.tab.licensing" },
  { key: "balance", labelKey: "reports.tab.balance" },
  { key: "coverage", labelKey: "reports.tab.coverage" },
  { key: "health", labelKey: "reports.tab.health" },
  { key: "roleBalance", labelKey: "reports.tab.roleBalance" },
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; tab?: string }>;
}) {
  const t = await getT();
  const sp = await searchParams;
  const def = quarterRange(new Date());
  const from = sp.from || def.from;
  const to = sp.to || def.to;
  const tab: Tab = (TAB_KEYS as string[]).includes(sp.tab ?? "")
    ? (sp.tab as Tab)
    : "licensing";

  const tabHref = (t: Tab) => `/reports?tab=${t}&from=${from}&to=${to}`;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow={t("reports.eyebrow")}>{t("reports.title")}</SectionTitle>
        <span className="text-sm text-ink-500">{rangeLabel(from, to)}</span>
      </div>

      {/* Tab nav */}
      <div className="flex flex-wrap gap-1 border-b border-white/[0.06]">
        {TABS.map((tabItem) => (
          <Link
            key={tabItem.key}
            href={tabHref(tabItem.key)}
            className={
              tabItem.key === tab
                ? "border-b-2 border-gold-400 px-3 py-2 text-sm font-medium text-ink-50"
                : "border-b-2 border-transparent px-3 py-2 text-sm text-ink-500 transition-colors hover:text-ink-200"
            }
          >
            {t(tabItem.labelKey)}
          </Link>
        ))}
      </div>

      {/* Date-range picker — GET form keeps the page server-rendered. */}
      <form method="GET" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value={tab} />
        <label className="flex flex-col gap-1 text-xs text-ink-500">
          {t("reports.from")}
          <input type="date" name="from" defaultValue={from} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-500">
          {t("reports.to")}
          <input type="date" name="to" defaultValue={to} className={input} />
        </label>
        <button
          type="submit"
          className="rounded-lg border border-white/10 px-3 py-2 text-sm text-ink-200 transition-colors hover:border-white/25"
        >
          {t("reports.update")}
        </button>
        <Link href={tabHref(tab)} className="self-center text-sm text-ink-500 hover:text-ink-300">
          {t("reports.thisQuarter")}
        </Link>
      </form>

      {tab === "licensing" ? (
        <LicensingTab from={from} to={to} />
      ) : tab === "balance" ? (
        <BalanceTab from={from} to={to} />
      ) : tab === "coverage" ? (
        <CoverageTab from={from} to={to} />
      ) : tab === "health" ? (
        <HealthTab />
      ) : (
        <RoleBalanceTab />
      )}
    </div>
  );
}

function DownloadButton({ kind, label }: { kind: string; label: string }) {
  return (
    <a
      href={`/reports/download?kind=${kind}`}
      className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
    >
      {label}
    </a>
  );
}

async function HealthTab() {
  const t = await getT();
  const { members, assignments } = await getChurnInputs();
  // The ONLY clock read: churn reasons relative to "now". The engine is pure;
  // the instant is supplied here so the report is reproducible from inputs.
  const now = new Date().toISOString();
  const report = buildChurnReport(members, assignments, now);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <DownloadButton kind="churn" label={t("reports.downloadCsv")} />
      </div>
      <VolunteerHealthTable report={report} t={t} />
    </div>
  );
}

async function RoleBalanceTab() {
  const t = await getT();
  const { roles, qualifications, targets } = await getRoleBalanceInputs();
  const report = buildRoleBalanceReport(roles, qualifications, targets);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <DownloadButton kind="role_balance" label={t("reports.downloadCsv")} />
      </div>
      <RoleBalanceTable report={report} t={t} />
    </div>
  );
}

async function BalanceTab({ from, to }: { from: string; to: string }) {
  const t = await getT();
  const [rows, settings] = await Promise.all([getServeRows(from, to), getChurchSettings()]);
  const report = buildVolunteerBalance(
    rows,
    from,
    to,
    settings?.default_max_assignments_per_month ?? null,
  );
  return <VolunteerBalanceTable report={report} t={t} />;
}

async function CoverageTab({ from, to }: { from: string; to: string }) {
  const t = await getT();
  const rows = await getCoverageRows(from, to);
  return <ServiceCoverageTable report={buildServiceCoverage(rows, from, to)} t={t} />;
}

async function LicensingTab({ from, to }: { from: string; to: string }) {
  const t = await getT();
  const rows = await getSongUsageRows(from, to);
  const tono = buildTonoReport(rows, from, to);
  const ccli = buildCcliReport(rows, from, to);

  return (
    <div className="space-y-8">
      <p className="text-xs text-ink-500">{t("reports.licensing.playedOnly")}</p>

      {/* ── TONO ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink-50">{t("reports.tono.heading")}</h2>
            <p className="mt-1 max-w-2xl text-xs text-ink-500">{t("reports.tono.blurb")}</p>
          </div>
          <a
            href={`/reports/download?kind=tono&from=${from}&to=${to}`}
            className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            {t("reports.downloadCsv")}
          </a>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label={t("reports.stat.gatheredPlays")} value={tono.totals.gatheredPlays} />
          <StatTile label={t("reports.stat.streamedPlays")} value={tono.totals.streamedPlays} tone="gold" hint={t("reports.stat.separatePool")} />
          <StatTile label={t("reports.stat.totalPlays")} value={tono.totals.totalPlays} />
          <StatTile label={t("reports.stat.reportableSongs")} value={tono.totals.reportableSongs} />
        </div>

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] text-left text-xs font-medium uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-3">{t("reports.col.title")}</th>
                  <th className="px-4 py-3">{t("reports.col.tonoWorkId")}</th>
                  <th className="px-4 py-3 text-right">{t("reports.col.total")}</th>
                  <th className="px-4 py-3 text-right">{t("reports.col.gathered")}</th>
                  <th className="px-4 py-3 text-right">{t("reports.col.streamed")}</th>
                  <th className="px-4 py-3">{t("reports.col.dates")}</th>
                </tr>
              </thead>
              <tbody>
                {tono.lines.map((l) => (
                  <tr key={l.songId} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-ink-100">{l.title}</td>
                    <td className="px-4 py-3 font-mono text-[0.75rem] text-ink-400">{l.tonoWorkId}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-200">{l.totalPlays}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-400">{l.gatheredPlays}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gold-300">{l.streamedPlays}</td>
                    <td className="px-4 py-3 text-[0.7rem] text-ink-600">{dates(l.serviceDates)}</td>
                  </tr>
                ))}
                {tono.lines.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-500">
                      {t("reports.tono.empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {tono.unregistered.length > 0 && (
          <Card className="px-5 py-4">
            <div className="flex items-center gap-2">
              <Badge tone="warning">{t("reports.unregistered")}</Badge>
              <span className="text-sm text-ink-200">
                {tono.unregistered.length === 1
                  ? t("reports.tono.unregistered.one", { count: tono.unregistered.length })
                  : t("reports.tono.unregistered.other", { count: tono.unregistered.length })}
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-xs text-ink-400">
              {tono.unregistered.map((u) => (
                <li key={u.songId}>
                  {u.totalPlays === 1
                    ? t("reports.tono.unregistered.line.one", { title: u.title, count: u.totalPlays })
                    : t("reports.tono.unregistered.line.other", { title: u.title, count: u.totalPlays })}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* ── CCLI ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink-50">{t("reports.ccli.heading")}</h2>
            <p className="mt-1 max-w-2xl text-xs text-ink-500">{t("reports.ccli.blurb")}</p>
          </div>
          <a
            href={`/reports/download?kind=ccli&from=${from}&to=${to}`}
            className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            {t("reports.downloadCsv")}
          </a>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <StatTile label={t("reports.stat.totalPlays")} value={ccli.totals.totalPlays} />
          <StatTile label={t("reports.stat.reportableSongs")} value={ccli.totals.reportableSongs} />
        </div>

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] text-left text-xs font-medium uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-3">{t("reports.col.title")}</th>
                  <th className="px-4 py-3">{t("reports.col.ccliNumber")}</th>
                  <th className="px-4 py-3 text-right">{t("reports.col.totalPlays")}</th>
                  <th className="px-4 py-3">{t("reports.col.dates")}</th>
                </tr>
              </thead>
              <tbody>
                {ccli.lines.map((l) => (
                  <tr key={l.songId} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-ink-100">{l.title}</td>
                    <td className="px-4 py-3 font-mono text-[0.75rem] text-ink-400">{l.ccliNumber}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-200">{l.totalPlays}</td>
                    <td className="px-4 py-3 text-[0.7rem] text-ink-600">{dates(l.serviceDates)}</td>
                  </tr>
                ))}
                {ccli.lines.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-ink-500">
                      {t("reports.ccli.empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {ccli.unregistered.length > 0 && (
          <Card className="px-5 py-4">
            <div className="flex items-center gap-2">
              <Badge tone="warning">{t("reports.unregistered")}</Badge>
              <span className="text-sm text-ink-200">
                {ccli.unregistered.length === 1
                  ? t("reports.ccli.unregistered.one", { count: ccli.unregistered.length })
                  : t("reports.ccli.unregistered.other", { count: ccli.unregistered.length })}
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-xs text-ink-400">
              {ccli.unregistered.map((u) => (
                <li key={u.songId}>
                  {u.totalPlays === 1
                    ? t("reports.ccli.unregistered.line.one", { title: u.title, count: u.totalPlays })
                    : t("reports.ccli.unregistered.line.other", { title: u.title, count: u.totalPlays })}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
