import type { VolunteerBalanceReport, ServiceCoverageReport } from "@sundayplan/sdk";
import { Badge, Card, StatTile } from "@/components/ui";

function deltaCell(delta: number | null) {
  if (delta == null) return <span className="text-ink-600">—</span>;
  if (delta > 0) return <span className="tabular-nums text-[color:var(--color-warning)]">+{delta}</span>;
  if (delta < 0) return <span className="tabular-nums text-[color:var(--color-info)]">{delta}</span>;
  return <span className="tabular-nums text-[color:var(--color-success)]">0</span>;
}

export function VolunteerBalanceTable({ report }: { report: VolunteerBalanceReport }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink-50">Volunteer balance</h2>
        <p className="mt-1 max-w-2xl text-xs text-ink-500">
          Who's carrying the load over {report.months} month{report.months === 1 ? "" : "s"}. Expected =
          target/month × months; delta flags <strong className="text-ink-300">over-served</strong> (＋, burnout
          risk) and under-served (−).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Total serves" value={report.totals.serves} />
        <StatTile label="Active volunteers" value={report.totals.activeVolunteers} />
        <StatTile label="Avg / volunteer" value={report.totals.averageServes.toFixed(1)} />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/[0.07] text-left text-xs font-medium uppercase tracking-wider text-ink-500">
                <th className="px-4 py-3">Volunteer</th>
                <th className="px-4 py-3 text-right">Serves</th>
                <th className="px-4 py-3 text-right">Services</th>
                <th className="px-4 py-3 text-right">Target/mo</th>
                <th className="px-4 py-3 text-right">Expected</th>
                <th className="px-4 py-3 text-right">Δ</th>
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
                    No serves in this range.
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

export function ServiceCoverageTable({ report }: { report: ServiceCoverageReport }) {
  const pct = Math.round(report.totals.coverage * 100);
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink-50">Service coverage</h2>
        <p className="mt-1 max-w-2xl text-xs text-ink-500">
          Required role slots (from each service's template) vs filled. Gaps are the roles still short.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Coverage" value={`${pct}%`} tone={pct >= 100 ? "gold" : "neutral"} />
        <StatTile label="Slots filled" value={`${report.totals.filledSlots}/${report.totals.requiredSlots}`} />
        <StatTile label="Fully covered" value={report.totals.fullyCovered} />
        <StatTile
          label="With gaps"
          value={report.totals.servicesWithGaps}
          tone={report.totals.servicesWithGaps > 0 ? "warning" : "neutral"}
        />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/[0.07] text-left text-xs font-medium uppercase tracking-wider text-ink-500">
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Filled</th>
                <th className="px-4 py-3 text-right">Coverage</th>
                <th className="px-4 py-3">Gaps</th>
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
                      <Badge tone="success">covered</Badge>
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
                    No templated services in this range. Coverage needs services created from a template.
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
