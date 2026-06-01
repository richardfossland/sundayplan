import { notFound } from "next/navigation";
import { SectionTitle } from "@/components/ui";
import { TemplateMessageForm } from "@/components/template-message-form";
import { getTemplate } from "@/lib/data/comms";
import { getT } from "@/lib/i18n/server";
import { updateTemplate } from "../../../actions";

export const dynamic = "force-dynamic";

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await getT();
  const { id } = await params;
  const template = await getTemplate(id);
  if (!template) notFound();

  // Bind the id so the shared form can call the action with just the FormData.
  const action = updateTemplate.bind(null, id);

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow={t("messages.eyebrow")}>{t("messages.template.editTitle")}</SectionTitle>
      <TemplateMessageForm template={template} action={action} submitLabel={t("messages.template.saveChanges")} />
    </div>
  );
}
