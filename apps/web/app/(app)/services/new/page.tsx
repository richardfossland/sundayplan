import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { NewServiceForm } from "@/components/service-form";
import { getServiceTemplates } from "@/lib/data/services";

export default async function NewServicePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const templates = await getServiceTemplates();
  // A calendar day click arrives as "YYYY-MM-DD"; default the time to 11:00.
  const defaultDate = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? `${date}T11:00` : undefined;
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href="/services" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← Services
        </Link>
        <div className="mt-2">
          <SectionTitle eyebrow="Plan">New service</SectionTitle>
        </div>
      </div>
      <Card className="px-5 py-5">
        <NewServiceForm templates={templates} defaultDate={defaultDate} />
      </Card>
    </div>
  );
}
