import type { Conflict } from "@sundayplan/sdk";
import type { EligibleMember, GridCell, GridRole, GridService } from "@/lib/data/schedule";
import { ScheduleCell } from "@/components/schedule-cell";
import { CopyWeek } from "@/components/copy-week";

type Tone = "success" | "warning" | "danger" | "neutral";

const DOT: Record<Tone, string> = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  neutral: "var(--color-ink-600)",
};

function isActive(status: string) {
  return status === "accepted" || status === "pending" || status === "invited" || status === "no_response";
}

export function ScheduleGrid({
  services,
  roles,
  cells,
  conflicts,
  memberNames,
  eligibleByRole,
  requiredByServiceRole,
  focus,
}: {
  services: GridService[];
  roles: GridRole[];
  cells: GridCell[];
  conflicts: Conflict[];
  memberNames: Record<string, string>;
  eligibleByRole: Record<string, EligibleMember[]>;
  requiredByServiceRole: Record<string, number>;
  /** "serviceId:roleId" of a cell to highlight (from a conflict "Resolve" CTA). */
  focus?: string;
}) {
  const cellsAt = (s: string, r: string) =>
    cells.filter((c) => c.service_id === s && c.role_id === r);
  const requiredFor = (s: string, r: string) => requiredByServiceRole[`${s}|${r}`] ?? 1;

  // Coverage = filled slots / required slots across all roles for the service.
  // Each role needs `required` (default 1); filled is the active count capped
  // at the requirement so over-assigning never reads as >100%.
  const coverage = (s: string) => {
    let filled = 0;
    let total = 0;
    for (const r of roles) {
      const req = requiredFor(s, r.id);
      total += req;
      const active = cellsAt(s, r.id).filter((c) => isActive(c.status)).length;
      filled += Math.min(active, req);
    }
    return { filled, total };
  };

  // A cell is flagged if a service-scoped conflict touches its role or member.
  const cellConflict = (c: GridCell): "hard" | "soft" | null => {
    let soft = false;
    for (const k of conflicts) {
      if (k.service_id !== c.service_id) continue;
      if (k.role_id === c.role_id || k.member_id === c.member_id) {
        if (k.severity === "hard") return "hard";
        soft = true;
      }
    }
    return soft ? "soft" : null;
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-ink-900/40">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/[0.07]">
            <th className="sticky left-0 z-10 bg-ink-900/80 px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500 backdrop-blur">
              Role
            </th>
            {services.map((s) => {
              const cov = coverage(s.id);
              const full = cov.filled === cov.total;
              return (
                <th key={s.id} className="px-4 py-3 text-left">
                  <div className="text-sm font-semibold text-ink-100">{s.label}</div>
                  <div className={`mt-0.5 text-[0.7rem] tabular-nums ${full ? "text-[color:var(--color-success)]" : "text-ink-500"}`}>
                    {cov.filled}/{cov.total} filled
                  </div>
                  <CopyWeek targetId={s.id} services={services} />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role.id} className="border-b border-white/[0.04] last:border-0">
              <td className="sticky left-0 z-10 bg-ink-900/80 px-4 py-3 backdrop-blur">
                <div className="font-medium text-ink-200">{role.name}</div>
                <div className="text-[0.7rem] text-ink-600">needs {role.skill}</div>
              </td>
              {services.map((s) => {
                const placed = cellsAt(s.id, role.id).map((c) => ({
                  assignment_id: c.assignment_id,
                  member_id: c.member_id,
                  status: c.status,
                }));
                const focused = focus === `${s.id}:${role.id}`;
                return (
                  <td
                    key={s.id}
                    id={`cell-${s.id}-${role.id}`}
                    className={
                      "px-4 py-3 align-top scroll-mt-24 " +
                      (focused ? "rounded-md ring-2 ring-gold-400/70 ring-inset" : "")
                    }>
                    <ScheduleCell
                      serviceId={s.id}
                      roleId={role.id}
                      placed={placed}
                      required={requiredFor(s.id, role.id)}
                      memberNames={memberNames}
                      eligible={eligibleByRole[role.id] ?? []}
                      flagFor={(c) =>
                        cellConflict({
                          assignment_id: c.assignment_id,
                          service_id: s.id,
                          role_id: role.id,
                          member_id: c.member_id,
                          status: c.status,
                        })
                      }
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ScheduleLegend() {
  const items: Array<[Tone, string]> = [
    ["success", "Accepted"],
    ["warning", "Pending"],
    ["danger", "Declined"],
    ["neutral", "No reply"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-ink-500">
      {items.map(([tone, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: DOT[tone] }} />
          {label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span style={{ color: "var(--color-danger)" }}>✕</span> hard conflict
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span style={{ color: "var(--color-warning)" }}>!</span> warning
      </span>
    </div>
  );
}
