import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, SectionTitle } from "@/components/ui";
import { EditServiceForm } from "@/components/service-form";
import { getServiceEditable } from "@/lib/data/services";

export default async function EditServicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const service = await getServiceEditable(id);
  if (!service) notFound();

  // The whole app is UTC-wall-clock; slice the stored ISO to the 16 chars a
  // datetime-local input wants (YYYY-MM-DDTHH:mm) for an exact round-trip.
  const startsAtLocal = service.starts_at_utc.slice(0, 16);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href={`/services/${id}`} className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← {service.name}
        </Link>
        <div className="mt-2">
          <SectionTitle eyebrow="Plan">Edit service</SectionTitle>
        </div>
      </div>
      <Card className="px-5 py-5">
        <EditServiceForm service={service} startsAtLocal={startsAtLocal} />
      </Card>
    </div>
  );
}
