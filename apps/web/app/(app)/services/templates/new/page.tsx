import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { NewTemplateForm } from "@/components/template-form";
import { getT } from "@/lib/i18n/server";

export default async function NewTemplatePage() {
  const t = await getT();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href="/services/templates" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← {t("services.templates")}
        </Link>
        <div className="mt-2">
          <SectionTitle eyebrow={t("nav.section.plan")}>{t("templates.newTemplateTitle")}</SectionTitle>
        </div>
      </div>
      <Card className="px-5 py-5">
        <NewTemplateForm />
      </Card>
      <p className="text-center text-xs text-ink-600">
        {t("templates.newFooterNote")}
      </p>
    </div>
  );
}
