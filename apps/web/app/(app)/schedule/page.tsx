import { SectionTitle } from "@/components/ui";
import { ConflictPanel } from "@/components/dashboard";
import { ScheduleGrid, ScheduleLegend } from "@/components/schedule";
import { AutoFillButton } from "@/components/autofill-button";
import { getSchedule } from "@/lib/data/schedule";

export default async function SchedulePage() {
  const { services, roles, cells, conflicts, memberNames, eligibleByRole, requiredByServiceRole } =
    await getSchedule();
  const roleNames = Object.fromEntries(roles.map((r) => [r.id, r.name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow="Upcoming services">Schedule</SectionTitle>
        <AutoFillButton />
      </div>
      <div className="flex justify-end">
        <ScheduleLegend />
      </div>

      <ScheduleGrid
        services={services}
        roles={roles}
        cells={cells}
        conflicts={conflicts}
        memberNames={memberNames}
        eligibleByRole={eligibleByRole}
        requiredByServiceRole={requiredByServiceRole}
      />

      <ConflictPanel conflicts={conflicts} roleNames={roleNames} memberNames={memberNames} />

      <p className="text-center text-xs text-ink-600">
        Conflict markers come straight from <span className="text-ink-400">detectConflicts()</span> in @sundayplan/sdk — run live against this church&apos;s rota.
      </p>
    </div>
  );
}
