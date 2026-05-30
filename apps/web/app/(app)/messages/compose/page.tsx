import { SectionTitle, Card } from "@/components/ui";
import { listComposeServices, listTemplates } from "@/lib/data/comms";
import { ComposeForm } from "@/components/compose-form";

export const dynamic = "force-dynamic";

export default async function ComposePage() {
  const [services, templates] = await Promise.all([
    listComposeServices(),
    listTemplates(),
  ]);

  if (services.length === 0) {
    return (
      <div className="space-y-6">
        <SectionTitle eyebrow="Communications">Compose message</SectionTitle>
        <Card className="px-5 py-10 text-center text-sm text-ink-500">
          No services to message yet. Create a service and assign volunteers first.
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Communications">Compose message</SectionTitle>
      <ComposeForm
        services={services}
        templates={templates.filter((t) => t.is_active)}
      />
      <p className="text-center text-xs text-ink-600">
        Sends go through the stub provider for now — recorded as deliveries, no live SMS/email
        until a real provider is configured. Volunteer accept/decline links land in Phase 7.
      </p>
    </div>
  );
}
