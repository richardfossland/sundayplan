import type { Conflict } from "@sundayplan/sdk";
import type { EligibleMember, GridCell, GridRole, GridService } from "@/lib/data/schedule";
import { ScheduleCell } from "@/components/schedule-cell";

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
}: {
  services: GridService[];
  roles: GridRole[];
  cells: GridCell[];
  conflicts: Conflict[];
  memberNames: Record<string, string>;
  eligibleByRole: Record<string, EligibleMember[]>;
}) {
  const cellAt = (s: string, r: string) => cells.find((c) => c.service_id === s && c.role_id === r);

  const coverage = (s: string) => {
    const filled = roles.filter((r) => {
      const c = cellAt(s, r.id);
      return c && isActive(c.status);
    }).length;
    return { filled, total: roles.length };
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
                const c = cellAt(s.id, role.id);
                const flag = c ? cellConflict(c) : null;
                return (
                  <td key={s.id} className="px-4 py-3 align-top">
                    <ScheduleCell
                      serviceId={s.id}
                      roleId={role.id}
                      cell={
                        c
                          ? { assignment_id: c.assignment_id, member_id: c.member_id, status: c.status }
                          : undefined
                      }
                      memberName={c ? memberNames[c.member_id] : undefined}
                      eligible={eligibleByRole[role.id] ?? []}
                      flag={flag}
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
