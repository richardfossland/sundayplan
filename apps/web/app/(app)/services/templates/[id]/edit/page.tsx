import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, SectionTitle } from "@/components/ui";
import { EditTemplateForm } from "@/components/template-form";
import { getTemplateEditable } from "@/lib/data/templates";
import { getT } from "@/lib/i18n/server";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getT();
  const template = await getTemplateEditable(id);
  if (!template) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href={`/services/templates/${id}`} className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← {template.name}
        </Link>
        <div className="mt-2">
          <SectionTitle eyebrow={t("nav.section.plan")}>{t("templates.editTemplate")}</SectionTitle>
        </div>
      </div>
      <Card className="px-5 py-5">
        <EditTemplateForm template={template} />
      </Card>
    </div>
  );
}
