import type {
  VolunteerBalanceReport,
  ServiceCoverageReport,
  ChurnReport,
  RoleBalanceReport,
} from "@sundayplan/sdk";
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

// ── Volunteer health (churn / retention) ──────────────────────────────────────

function bucketLabel(min: number, max: number | null): string {
  return max == null ? `${min}+` : `${min}–${max}`;
}

export function VolunteerHealthTable({ report, t }: { report: ChurnReport; t: TFn }) {
  const bucketTotal = report.firstServeBuckets.reduce((n, b) => n + b.count, 0) + report.firstServeUnknown;
  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink-50">{t("reports.health.heading")}</h2>
        <p className="mt-1 max-w-2xl text-xs text-ink-500">{t("reports.health.blurb")}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={t("reports.health.stat.members")} value={report.totals.members} />
        <StatTile label={t("reports.health.stat.everServed")} value={report.totals.everServed} />
        <StatTile
          label={t("reports.health.stat.atRisk")}
          value={report.atRisk.length}
          tone={report.atRisk.length > 0 ? "warning" : "neutral"}
        />
        <StatTile
          label={t("reports.health.stat.dropout")}
          value={report.dropout.length}
          tone={report.dropout.length > 0 ? "danger" : "neutral"}
        />
      </div>

      {/* Retention snapshot */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink-200">{t("reports.health.retention.heading")}</h3>
        <div className="grid grid-cols-3 gap-3">
          {report.retention.map((p) => (
            <StatTile
              key={p.months}
              label={t("reports.health.retention.label", { months: p.months })}
              value={p.rate == null ? "—" : `${Math.round(p.rate * 100)}%`}
              hint={t("reports.health.retention.hint", { active: p.stillActive, eligible: p.eligible })}
            />
          ))}
        </div>
      </div>

      {/* Time-to-first-assignment histogram */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink-200">{t("reports.health.firstServe.heading")}</h3>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] text-left text-xs font-medium uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-3">{t("reports.health.firstServe.col.bucket")}</th>
                  <th className="px-4 py-3 text-right">{t("reports.health.firstServe.col.count")}</th>
                </tr>
              </thead>
              <tbody>
                {report.firstServeBuckets.map((b) => (
                  <tr key={b.key} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-4 py-3 text-ink-100">
                      {t("reports.health.firstServe.days", { range: bucketLabel(b.minDays, b.maxDays) })}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-200">{b.count}</td>
                  </tr>
                ))}
                <tr className="border-b border-white/[0.04] last:border-0">
                  <td className="px-4 py-3 text-ink-400">{t("reports.health.firstServe.unknown")}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-400">{report.firstServeUnknown}</td>
                </tr>
                {bucketTotal === 0 && (
                  <tr>
                    <td colSpan={2} className="px-4 py-8 text-center text-sm text-ink-500">
                      {t("reports.health.empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* At-risk list */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink-200">{t("reports.health.atRisk.heading")}</h3>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] text-left text-xs font-medium uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-3">{t("reports.health.col.volunteer")}</th>
                  <th className="px-4 py-3">{t("reports.health.atRisk.col.lastServe")}</th>
                  <th className="px-4 py-3 text-right">{t("reports.health.atRisk.col.silentDays")}</th>
                </tr>
              </thead>
              <tbody>
                {report.atRisk.map((a) => (
                  <tr key={a.memberId} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-ink-100">{a.name}</td>
                    <td className="px-4 py-3 text-[0.75rem] text-ink-500">{a.lastServeLocal}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[color:var(--color-warning)]">
                      {a.daysSinceLastServe}
                    </td>
                  </tr>
                ))}
                {report.atRisk.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-sm text-ink-500">
                      {t("reports.health.atRisk.empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Dropout list */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink-200">{t("reports.health.dropout.heading")}</h3>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] text-left text-xs font-medium uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-3">{t("reports.health.col.volunteer")}</th>
                  <th className="px-4 py-3">{t("reports.health.dropout.col.joined")}</th>
                  <th className="px-4 py-3 text-right">{t("reports.health.dropout.col.months")}</th>
                </tr>
              </thead>
              <tbody>
                {report.dropout.map((d) => (
                  <tr key={d.memberId} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-ink-100">{d.name}</td>
                    <td className="px-4 py-3 text-[0.75rem] text-ink-500">{d.joinedAtLocal}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[color:var(--color-danger)]">
                      {d.monthsSinceJoin}
                    </td>
                  </tr>
                ))}
                {report.dropout.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-sm text-ink-500">
                      {t("reports.health.dropout.empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </section>
  );
}

// ── Role balance (recruiting heatmap) ─────────────────────────────────────────

function roleDeltaCell(line: RoleBalanceReport["lines"][number], t: TFn) {
  if (line.delta == null) return <span className="text-ink-600">—</span>;
  if (line.status === "over")
    return <span className="tabular-nums text-[color:var(--color-success)]">+{line.delta}</span>;
  if (line.status === "under")
    return <span className="tabular-nums text-[color:var(--color-danger)]">{line.delta}</span>;
  return <span className="tabular-nums text-ink-300">{t("reports.roleBalance.balanced")}</span>;
}

export function RoleBalanceTable({ report, t }: { report: RoleBalanceReport; t: TFn }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink-50">{t("reports.roleBalance.heading")}</h2>
        <p className="mt-1 max-w-2xl text-xs text-ink-500">{t("reports.roleBalance.blurb")}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={t("reports.roleBalance.stat.roles")} value={report.totals.roles} />
        <StatTile
          label={t("reports.roleBalance.stat.underStaffed")}
          value={report.totals.underStaffed}
          tone={report.totals.underStaffed > 0 ? "danger" : "neutral"}
        />
        <StatTile label={t("reports.roleBalance.stat.overStaffed")} value={report.totals.overStaffed} tone="gold" />
        <StatTile
          label={t("reports.roleBalance.stat.shortfall")}
          value={report.totals.totalShortfall}
          tone={report.totals.totalShortfall > 0 ? "warning" : "neutral"}
        />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/[0.07] text-left text-xs font-medium uppercase tracking-wider text-ink-500">
                <th className="px-4 py-3">{t("reports.roleBalance.col.role")}</th>
                <th className="px-4 py-3">{t("reports.roleBalance.col.team")}</th>
                <th className="px-4 py-3 text-right">{t("reports.roleBalance.col.active")}</th>
                <th className="px-4 py-3 text-right">{t("reports.roleBalance.col.qualified")}</th>
                <th className="px-4 py-3 text-right">{t("reports.roleBalance.col.target")}</th>
                <th className="px-4 py-3 text-right">{t("reports.roleBalance.col.delta")}</th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((l) => (
                <tr key={l.roleId} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-ink-100">
                    {l.status === "under" ? (
                      <span className="flex items-center gap-2">
                        {l.role}
                        <Badge tone="danger">{t("reports.roleBalance.recruit")}</Badge>
                      </span>
                    ) : (
                      l.role
                    )}
                  </td>
                  <td className="px-4 py-3 text-[0.75rem] text-ink-500">{l.teamName ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-200">{l.activeQualified}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-400">{l.qualified}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-400">{l.target ?? "—"}</td>
                  <td className="px-4 py-3 text-right">{roleDeltaCell(l, t)}</td>
                </tr>
              ))}
              {report.lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-500">
                    {t("reports.roleBalance.empty")}
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
