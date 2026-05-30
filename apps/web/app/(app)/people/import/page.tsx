import { SectionTitle } from "@/components/ui";
import { ImportForm } from "@/components/import-form";

export default function Page() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <SectionTitle eyebrow="People">Bulk import</SectionTitle>
      <ImportForm />
    </div>
  );
}
