import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionTitle } from "@/components/ui";
import { TemplateEditor } from "@/components/template-editor";
import { getTemplate, getChurchRoleOptions } from "@/lib/data/templates";
import { getT } from "@/lib/i18n/server";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getT();
  const template = await getTemplate(id);
  if (!template) notFound();
  const roles = await getChurchRoleOptions();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/services/templates" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← {t("services.templates")}
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <SectionTitle>{template.name}</SectionTitle>
          <Link
            href={`/services/templates/${id}/edit`}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            {t("common.edit")}
          </Link>
        </div>
        <p className="mt-2 text-sm text-ink-400">{t("templates.defaultDuration", { min: template.default_duration_min })}</p>
      </div>

      <TemplateEditor
        templateId={template.id}
        items={template.items}
        requirements={template.requirements}
        roles={roles}
      />
    </div>
  );
}
