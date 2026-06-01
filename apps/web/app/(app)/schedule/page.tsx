import { SectionTitle } from "@/components/ui";
import { ConflictPanel } from "@/components/dashboard";
import { ScheduleGrid, ScheduleLegend } from "@/components/schedule";
import { ScheduleMobile } from "@/components/schedule-mobile";
import { AutoFillButton } from "@/components/autofill-button";
import { getSchedule } from "@/lib/data/schedule";
import { getT } from "@/lib/i18n/server";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const { focus } = await searchParams;
  const [{ services, roles, cells, conflicts, memberNames, eligibleByRole, requiredByServiceRole }, t] =
    await Promise.all([getSchedule(), getT()]);
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

      <div className="hidden lg:block">
        <ScheduleGrid
          services={services}
          roles={roles}
          cells={cells}
          conflicts={conflicts}
          memberNames={memberNames}
          eligibleByRole={eligibleByRole}
          requiredByServiceRole={requiredByServiceRole}
          focus={focus}
        />
      </div>
      <div className="lg:hidden">
        <ScheduleMobile
          services={services}
          roles={roles}
          cells={cells}
          conflicts={conflicts}
          memberNames={memberNames}
          eligibleByRole={eligibleByRole}
          requiredByServiceRole={requiredByServiceRole}
        />
      </div>

      <ConflictPanel conflicts={conflicts} roleNames={roleNames} memberNames={memberNames} t={t} />

      <p className="text-center text-xs text-ink-600">
        Conflict markers come straight from <span className="text-ink-400">detectConflicts()</span> in @sundayplan/sdk — run live against this church&apos;s rota.
      </p>
    </div>
  );
}
