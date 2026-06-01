import { SectionTitle } from "@/components/ui";
import { HolidayForm } from "@/components/holiday-form";
import { getT } from "@/lib/i18n/server";

export default async function Page() {
  const t = await getT();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <SectionTitle eyebrow={t("people.eyebrowPeople")}>{t("people.churchHoliday")}</SectionTitle>
      <p className="text-sm text-ink-500">{t("people.holidayIntro")}</p>
      <HolidayForm />
    </div>
  );
}
