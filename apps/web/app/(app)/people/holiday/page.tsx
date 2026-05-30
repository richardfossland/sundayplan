import { SectionTitle } from "@/components/ui";
import { HolidayForm } from "@/components/holiday-form";

export default function Page() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <SectionTitle eyebrow="People">Church holiday</SectionTitle>
      <p className="text-sm text-ink-500">
        Mark a date (or range) when the whole church is away — a camp, a break, a public
        holiday. Each member gets an unavailability record, so auto-fill and conflict
        warnings respect it right away. Individual members can still be edited on their page.
      </p>
      <HolidayForm />
    </div>
  );
}
