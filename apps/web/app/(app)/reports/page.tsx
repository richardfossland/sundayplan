import Link from "next/link";
import {
  buildTonoReport,
  buildCcliReport,
  buildVolunteerBalance,
  buildServiceCoverage,
  quarterRange,
  rangeLabel,
} from "@sundayplan/sdk";
import { Badge, Card, SectionTitle, StatTile } from "@/components/ui";
import {
  VolunteerBalanceTable,
  ServiceCoverageTable,
} from "@/components/reports-operational";
import {
  getSongUsageRows,
  getServeRows,
  getCoverageRows,
} from "@/lib/data/reports";
import { getChurchSettings } from "@/lib/data/settings";

export const dynamic = "force-dynamic";

const input =
  "rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none focus:border-gold-400/50";

function dates(list: string[]): string {
  return list.join(", ");
}

type Tab = "licensing" | "balance" | "coverage";
const TABS: { key: Tab; label: string }[] = [
  { key: "licensing", label: "Licensing" },
  { key: "balance", label: "Volunteer balance" },
  { key: "coverage", label: "Service coverage" },
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const def = quarterRange(new Date());
  const from = sp.from || def.from;
  const to = sp.to || def.to;
  const tab: Tab =
    sp.tab === "balance" || sp.tab === "coverage" ? sp.tab : "licensing";

  const tabHref = (t: Tab) => `/reports?tab=${t}&from=${from}&to=${to}`;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow="Insights">Reports</SectionTitle>
        <span className="text-sm text-ink-500">{rangeLabel(from, to)}</span>
      </div>

      {/* Tab nav */}
      <div className="flex flex-wrap gap-1 border-b border-white/[0.06]">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            className={
              t.key === tab
                ? "border-b-2 border-gold-400 px-3 py-2 text-sm font-medium text-ink-50"
                : "border-b-2 border-transparent px-3 py-2 text-sm text-ink-500 transition-colors hover:text-ink-200"
            }
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* Date-range picker — GET form keeps the page server-rendered. */}
      <form method="GET" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value={tab} />
        <label className="flex flex-col gap-1 text-xs text-ink-500">
          From (inclusive)
          <input type="date" name="from" defaultValue={from} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-500">
          To (exclusive)
          <input type="date" name="to" defaultValue={to} className={input} />
        </label>
        <button
          type="submit"
          className="rounded-lg border border-white/10 px-3 py-2 text-sm text-ink-200 transition-colors hover:border-white/25"
        >
          Update
        </button>
        <Link href={tabHref(tab)} className="self-center text-sm text-ink-500 hover:text-ink-300">
          This quarter
        </Link>
      </form>

      {tab === "licensing" ? (
        <LicensingTab from={from} to={to} />
      ) : tab === "balance" ? (
        <BalanceTab from={from} to={to} />
      ) : (
        <CoverageTab from={from} to={to} />
      )}
    </div>
  );
}

async function BalanceTab({ from, to }: { from: string; to: string }) {
  const [rows, settings] = await Promise.all([getServeRows(from, to), getChurchSettings()]);
  const report = buildVolunteerBalance(
    rows,
    from,
    to,
    settings?.default_max_assignments_per_month ?? null,
  );
  return <VolunteerBalanceTable report={report} />;
}

async function CoverageTab({ from, to }: { from: string; to: string }) {
  const rows = await getCoverageRows(from, to);
  return <ServiceCoverageTable report={buildServiceCoverage(rows, from, to)} />;
}

async function LicensingTab({ from, to }: { from: string; to: string }) {
  const rows = await getSongUsageRows(from, to);
  const tono = buildTonoReport(rows, from, to);
  const ccli = buildCcliReport(rows, from, to);

  return (
    <div className="space-y-8">
      <p className="text-xs text-ink-500">
        Only <strong className="text-ink-300">played</strong> services count.
      </p>

      {/* ── TONO ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink-50">TONO usage</h2>
            <p className="mt-1 max-w-2xl text-xs text-ink-500">
              Submit to TONO. Streaming is a <strong className="text-ink-300">separate royalty pool</strong>,
              so streamed and gathered plays are reported apart. Only songs with a TONO work id are reportable.
            </p>
          </div>
          <a
            href={`/reports/download?kind=tono&from=${from}&to=${to}`}
            className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            Download CSV
          </a>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Gathered plays" value={tono.totals.gatheredPlays} />
          <StatTile label="Streamed plays" value={tono.totals.streamedPlays} tone="gold" hint="separate pool" />
          <StatTile label="Total plays" value={tono.totals.totalPlays} />
          <StatTile label="Reportable songs" value={tono.totals.reportableSongs} />
        </div>

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] text-left text-xs font-medium uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">TONO work id</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Gathered</th>
                  <th className="px-4 py-3 text-right">Streamed</th>
                  <th className="px-4 py-3">Dates</th>
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
                      No TONO-reportable plays in this range.
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
              <Badge tone="warning">unregistered</Badge>
              <span className="text-sm text-ink-200">
                {tono.unregistered.length} played song{tono.unregistered.length === 1 ? "" : "s"} not reportable to TONO
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-xs text-ink-400">
              {tono.unregistered.map((u) => (
                <li key={u.songId}>
                  {u.title} — {u.totalPlays} play{u.totalPlays === 1 ? "" : "s"}; add a TONO work id on the song.
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
            <h2 className="text-lg font-semibold tracking-tight text-ink-50">CCLI usage</h2>
            <p className="mt-1 max-w-2xl text-xs text-ink-500">
              Report to CCLI (SongSelect-style). Per-song play counts and dates; only songs with a CCLI number are reportable.
            </p>
          </div>
          <a
            href={`/reports/download?kind=ccli&from=${from}&to=${to}`}
            className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            Download CSV
          </a>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <StatTile label="Total plays" value={ccli.totals.totalPlays} />
          <StatTile label="Reportable songs" value={ccli.totals.reportableSongs} />
        </div>

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] text-left text-xs font-medium uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">CCLI number</th>
                  <th className="px-4 py-3 text-right">Total plays</th>
                  <th className="px-4 py-3">Dates</th>
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
                      No CCLI-reportable plays in this range.
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
              <Badge tone="warning">unregistered</Badge>
              <span className="text-sm text-ink-200">
                {ccli.unregistered.length} played song{ccli.unregistered.length === 1 ? "" : "s"} have no CCLI number
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-xs text-ink-400">
              {ccli.unregistered.map((u) => (
                <li key={u.songId}>
                  {u.title} — {u.totalPlays} play{u.totalPlays === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
