import { SectionTitle, Card } from "@/components/ui";
import { listComposeServices, listTemplates } from "@/lib/data/comms";
import { ComposeForm } from "@/components/compose-form";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function ComposePage() {
  const t = await getT();
  const [services, templates] = await Promise.all([
    listComposeServices(),
    listTemplates(),
  ]);

  if (services.length === 0) {
    return (
      <div className="space-y-6">
        <SectionTitle eyebrow={t("messages.eyebrow")}>{t("messages.compose.title")}</SectionTitle>
        <Card className="px-5 py-10 text-center text-sm text-ink-500">
          {t("messages.compose.noServices")}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow={t("messages.eyebrow")}>{t("messages.compose.title")}</SectionTitle>
      <ComposeForm
        services={services}
        templates={templates.filter((t) => t.is_active)}
      />
      <p className="text-center text-xs text-ink-600">
        {t("messages.compose.footer")}
      </p>
    </div>
  );
}
