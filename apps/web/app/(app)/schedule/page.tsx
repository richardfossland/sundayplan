import { detectConflicts } from "@sundayplan/sdk";
import { SectionTitle } from "@/components/ui";
import { ConflictPanel } from "@/components/dashboard";
import { ScheduleGrid, ScheduleLegend } from "@/components/schedule";
import {
  MEMBER_NAMES,
  ROLE_NAMES,
  buildScheduleConflictContext,
  buildScheduleGrid,
} from "@/lib/mock";

export default function SchedulePage() {
  const { services, roles, cells } = buildScheduleGrid();
  const conflicts = detectConflicts(buildScheduleConflictContext());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow="Next 4 Sundays">Schedule</SectionTitle>
        <ScheduleLegend />
      </div>

      <ScheduleGrid
        services={services}
        roles={roles}
        cells={cells}
        conflicts={conflicts}
        memberNames={MEMBER_NAMES}
      />

      <ConflictPanel conflicts={conflicts} roleNames={ROLE_NAMES} memberNames={MEMBER_NAMES} />

      <p className="text-center text-xs text-ink-600">
        Conflict markers come straight from <span className="text-ink-400">detectConflicts()</span> in @sundayplan/sdk — run live against this rota.
      </p>
    </div>
  );
}
