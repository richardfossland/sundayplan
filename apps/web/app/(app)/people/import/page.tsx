import { SectionTitle } from "@/components/ui";
import { ImportForm } from "@/components/import-form";
import { getT } from "@/lib/i18n/server";

export default async function Page() {
  const t = await getT();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <SectionTitle eyebrow={t("people.eyebrowPeople")}>{t("people.bulkImport")}</SectionTitle>
      <ImportForm />
    </div>
  );
}
