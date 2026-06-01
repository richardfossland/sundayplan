import type { VolunteerBalanceReport, ServiceCoverageReport } from "@sundayplan/sdk";
import { Badge, Card, StatTile } from "@/components/ui";
import type { TFn } from "@/lib/i18n/server";

function deltaCell(delta: number | null) {
  if (delta == null) return <span className="text-ink-600">—</span>;
  if (delta > 0) return <span className="tabular-nums text-[color:var(--color-warning)]">+{delta}</span>;
  if (delta < 0) return <span className="tabular-nums text-[color:var(--color-info)]">{delta}</span>;
  return <span className="tabular-nums text-[color:var(--color-success)]">0</span>;
}

export function VolunteerBalanceTable({ report, t }: { report: VolunteerBalanceReport; t: TFn }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink-50">{t("reports.balance.heading")}</h2>
        <p className="mt-1 max-w-2xl text-xs text-ink-500">
          {report.months === 1
            ? t("reports.balance.blurb.one", { count: report.months })
            : t("reports.balance.blurb.other", { count: report.months })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label={t("reports.balance.stat.totalServes")} value={report.totals.serves} />
        <StatTile label={t("reports.balance.stat.activeVolunteers")} value={report.totals.activeVolunteers} />
        <StatTile label={t("reports.balance.stat.avgPerVolunteer")} value={report.totals.averageServes.toFixed(1)} />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/[0.07] text-left text-xs font-medium uppercase tracking-wider text-ink-500">
                <th className="px-4 py-3">{t("reports.balance.col.volunteer")}</th>
                <th className="px-4 py-3 text-right">{t("reports.balance.col.serves")}</th>
                <th className="px-4 py-3 text-right">{t("reports.balance.col.services")}</th>
                <th className="px-4 py-3 text-right">{t("reports.balance.col.targetPerMonth")}</th>
                <th className="px-4 py-3 text-right">{t("reports.balance.col.expected")}</th>
                <th className="px-4 py-3 text-right">{t("reports.balance.col.delta")}</th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((l) => (
                <tr key={l.memberId} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-ink-100">{l.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-200">{l.serves}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-400">{l.services}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-400">{l.targetPerMonth ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-400">{l.expectedServes ?? "—"}</td>
                  <td className="px-4 py-3 text-right">{deltaCell(l.delta)}</td>
                </tr>
              ))}
              {report.lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-500">
                    {t("reports.balance.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

export function ServiceCoverageTable({ report, t }: { report: ServiceCoverageReport; t: TFn }) {
  const pct = Math.round(report.totals.coverage * 100);
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink-50">{t("reports.coverage.heading")}</h2>
        <p className="mt-1 max-w-2xl text-xs text-ink-500">{t("reports.coverage.blurb")}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={t("reports.coverage.stat.coverage")} value={`${pct}%`} tone={pct >= 100 ? "gold" : "neutral"} />
        <StatTile label={t("reports.coverage.stat.slotsFilled")} value={`${report.totals.filledSlots}/${report.totals.requiredSlots}`} />
        <StatTile label={t("reports.coverage.stat.fullyCovered")} value={report.totals.fullyCovered} />
        <StatTile
          label={t("reports.coverage.stat.withGaps")}
          value={report.totals.servicesWithGaps}
          tone={report.totals.servicesWithGaps > 0 ? "warning" : "neutral"}
        />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/[0.07] text-left text-xs font-medium uppercase tracking-wider text-ink-500">
                <th className="px-4 py-3">{t("reports.coverage.col.service")}</th>
                <th className="px-4 py-3">{t("reports.coverage.col.date")}</th>
                <th className="px-4 py-3 text-right">{t("reports.coverage.col.filled")}</th>
                <th className="px-4 py-3 text-right">{t("reports.coverage.col.coverage")}</th>
                <th className="px-4 py-3">{t("reports.coverage.col.gaps")}</th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((l) => (
                <tr key={l.serviceId} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-ink-100">{l.name}</td>
                  <td className="px-4 py-3 text-[0.7rem] text-ink-500">{l.date}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-200">
                    {l.filledSlots}/{l.requiredSlots}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-300">
                    {Math.round(l.coverage * 100)}%
                  </td>
                  <td className="px-4 py-3">
                    {l.gaps.length === 0 ? (
                      <Badge tone="success">{t("reports.coverage.covered")}</Badge>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {l.gaps.map((g) => (
                          <Badge key={g.roleId} tone="warning">
                            {g.role} −{g.missing}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {report.lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-500">
                    {t("reports.coverage.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
