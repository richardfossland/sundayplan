import { SectionTitle } from "@/components/ui";
import { TemplateMessageForm } from "@/components/template-message-form";
import { createTemplate } from "../../actions";

export const dynamic = "force-dynamic";

export default function NewTemplatePage() {
  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Communications">New template</SectionTitle>
      <TemplateMessageForm action={createTemplate} submitLabel="Create template" />
    </div>
  );
}
