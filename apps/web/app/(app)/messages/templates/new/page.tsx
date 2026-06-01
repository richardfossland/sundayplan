import { SectionTitle } from "@/components/ui";
import { TemplateMessageForm } from "@/components/template-message-form";
import { getT } from "@/lib/i18n/server";
import { createTemplate } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewTemplatePage() {
  const t = await getT();
  return (
    <div className="space-y-6">
      <SectionTitle eyebrow={t("messages.eyebrow")}>{t("messages.template.newTitle")}</SectionTitle>
      <TemplateMessageForm action={createTemplate} submitLabel={t("messages.template.create")} />
    </div>
  );
}
