import { SectionTitle } from "@/components/ui";
import { ConflictPanel } from "@/components/dashboard";
import { ScheduleGrid, ScheduleLegend } from "@/components/schedule";
import { ScheduleMobile } from "@/components/schedule-mobile";
import { AutoFillButton } from "@/components/autofill-button";
import { getSchedule } from "@/lib/data/schedule";
import { getT, getLocale } from "@/lib/i18n/server";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const { focus } = await searchParams;
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const { services, roles, cells, conflicts, memberNames, eligibleByRole, requiredByServiceRole } =
    await getSchedule(locale);
  const roleNames = Object.fromEntries(roles.map((r) => [r.id, r.name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow={t("schedule.eyebrow")}>{t("schedule.title")}</SectionTitle>
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

      <p className="text-center text-xs text-ink-600">{t("schedule.footer")}</p>
    </div>
  );
}
