"use client";

import { useState } from "react";
import type { Conflict } from "@sundayplan/sdk";
import type { EligibleMember, GridCell, GridRole, GridService } from "@/lib/data/schedule";
import { ScheduleCell } from "@/components/schedule-cell";

function isActive(status: string) {
  return status === "accepted" || status === "pending" || status === "invited" || status === "no_response";
}

/**
 * Phone view of the Matrix — a wide roles×services table doesn't fit 375px, so
 * we pivot to a per-service accordion (service → roles → the same ScheduleCell).
 * Rendered below the `lg` breakpoint; the table takes over above it.
 */
export function ScheduleMobile({
  services,
  roles,
  cells,
  conflicts,
  memberNames,
  eligibleByRole,
  requiredByServiceRole,
}: {
  services: GridService[];
  roles: GridRole[];
  cells: GridCell[];
  conflicts: Conflict[];
  memberNames: Record<string, string>;
  eligibleByRole: Record<string, EligibleMember[]>;
  requiredByServiceRole: Record<string, number>;
}) {
  const [openId, setOpenId] = useState<string | null>(services[0]?.id ?? null);

  const cellsAt = (s: string, r: string) => cells.filter((c) => c.service_id === s && c.role_id === r);
  const requiredFor = (s: string, r: string) => requiredByServiceRole[`${s}|${r}`] ?? 1;

  const coverage = (s: string) => {
    let filled = 0;
    let total = 0;
    for (const r of roles) {
      const req = requiredFor(s, r.id);
      total += req;
      filled += Math.min(cellsAt(s, r.id).filter((c) => isActive(c.status)).length, req);
    }
    return { filled, total };
  };

  const cellConflict = (serviceId: string, roleId: string, memberId: string): "hard" | "soft" | null => {
    let soft = false;
    for (const k of conflicts) {
      if (k.service_id !== serviceId) continue;
      if (k.role_id === roleId || k.member_id === memberId) {
        if (k.severity === "hard") return "hard";
        soft = true;
      }
    }
    return soft ? "soft" : null;
  };

  return (
    <div className="space-y-2">
      {services.map((s) => {
        const cov = coverage(s.id);
        const full = cov.filled === cov.total;
        const open = openId === s.id;
        return (
          <div key={s.id} className="overflow-hidden rounded-xl border border-white/[0.07] bg-ink-900/40">
            <button
              onClick={() => setOpenId(open ? null : s.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="font-semibold text-ink-100">{s.label}</span>
              <span
                className={`text-xs tabular-nums ${full ? "text-[color:var(--color-success)]" : "text-ink-500"}`}
              >
                {cov.filled}/{cov.total} · {open ? "▲" : "▼"}
              </span>
            </button>
            {open ? (
              <div className="divide-y divide-white/[0.04] border-t border-white/[0.07]">
                {roles.map((role) => {
                  const placed = cellsAt(s.id, role.id).map((c) => ({
                    assignment_id: c.assignment_id,
                    member_id: c.member_id,
                    status: c.status,
                  }));
                  return (
                    <div key={role.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="pt-1">
                        <div className="text-sm font-medium text-ink-200">{role.name}</div>
                        <div className="text-[0.7rem] text-ink-600">needs {role.skill}</div>
                      </div>
                      <div className="min-w-0 flex-1 text-right">
                        <ScheduleCell
                          serviceId={s.id}
                          roleId={role.id}
                          placed={placed}
                          required={requiredFor(s.id, role.id)}
                          memberNames={memberNames}
                          eligible={eligibleByRole[role.id] ?? []}
                          flagFor={(c) => cellConflict(s.id, role.id, c.member_id)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
