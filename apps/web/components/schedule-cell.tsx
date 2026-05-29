"use client";

import { useState, useTransition } from "react";
import type { AssignmentStatus } from "@sundayplan/shared";
import type { EligibleMember } from "@/lib/data/schedule";
import { createAssignment, removeAssignment } from "@/app/(app)/schedule/actions";

type Tone = "success" | "warning" | "danger" | "neutral";

const DOT: Record<Tone, string> = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  neutral: "var(--color-ink-600)",
};

const STATUS_TONE: Record<string, Tone> = {
  accepted: "success",
  pending: "warning",
  invited: "warning",
  no_response: "neutral",
  declined: "danger",
  removed: "neutral",
};

const SKILL_DOT: Record<string, string> = {
  trainer: "var(--color-gold-400)",
  lead: "var(--color-gold-400)",
  capable: "var(--color-royal-400)",
  training: "var(--color-ink-600)",
};

function firstName(name: string) {
  return name.split(" ")[0];
}

export interface CellAssignment {
  assignment_id: string;
  member_id: string;
  status: AssignmentStatus;
}

export function ScheduleCell({
  serviceId,
  roleId,
  cell,
  memberName,
  eligible,
  flag,
}: {
  serviceId: string;
  roleId: string;
  cell?: CellAssignment;
  memberName?: string;
  eligible: EligibleMember[];
  flag: "hard" | "soft" | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const assigned = new Set(cell ? [cell.member_id] : []);

  function assign(memberId: string) {
    setOpen(false);
    startTransition(() => createAssignment(serviceId, roleId, memberId));
  }
  function remove() {
    if (!cell) return;
    startTransition(() => removeAssignment(cell.assignment_id));
  }

  // Filled slot (a declined cell still shows the person, struck through).
  if (cell && cell.status !== "removed") {
    const tone = STATUS_TONE[cell.status] ?? "neutral";
    const declined = cell.status === "declined";
    return (
      <div className="flex items-center gap-2">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: DOT[tone] }}
          title={cell.status}
        />
        <span className={`text-ink-100 ${declined ? "text-ink-500 line-through" : ""}`}>
          {firstName(memberName ?? cell.member_id)}
        </span>
        {flag ? (
          <span
            className="text-xs leading-none"
            style={{ color: flag === "hard" ? "var(--color-danger)" : "var(--color-warning)" }}
            title={flag === "hard" ? "Hard conflict" : "Warning"}
          >
            {flag === "hard" ? "✕" : "!"}
          </span>
        ) : null}
        <button
          onClick={remove}
          disabled={pending}
          aria-label="Remove assignment"
          className="ml-0.5 text-ink-600 transition-colors hover:text-[color:var(--color-danger)] disabled:opacity-40"
        >
          ×
        </button>
      </div>
    );
  }

  // Empty slot — assign picker.
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="inline-flex h-7 items-center rounded-md border border-dashed border-white/10 px-2 text-xs text-ink-600 transition-colors hover:border-gold-400/40 hover:text-gold-300 disabled:opacity-40"
      >
        {pending ? "…" : "+ assign"}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-8 z-30 min-w-44 rounded-lg border border-white/10 bg-ink-900 p-1 shadow-xl">
            {eligible.length === 0 ? (
              <p className="px-2 py-2 text-xs text-ink-500">
                No one is trained for this role yet — add them in Teams.
              </p>
            ) : (
              eligible.map((m) => {
                const taken = assigned.has(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => !taken && assign(m.id)}
                    disabled={taken}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-200 transition-colors hover:bg-white/[0.06] disabled:opacity-40"
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: SKILL_DOT[m.skill] ?? DOT.neutral }}
                      title={m.skill}
                    />
                    <span className="flex-1">{m.name}</span>
                    <span className="text-[0.7rem] uppercase text-ink-600">{m.skill}</span>
                  </button>
                );
              })
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
