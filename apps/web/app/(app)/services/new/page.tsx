import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { NewServiceForm } from "@/components/service-form";
import { getServiceTemplates } from "@/lib/data/services";

export default async function NewServicePage() {
  const templates = await getServiceTemplates();
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
        <NewServiceForm templates={templates} />
      </Card>
    </div>
  );
}
