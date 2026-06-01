import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { getTemplates } from "@/lib/data/templates";
import { getT } from "@/lib/i18n/server";

export default async function TemplatesPage() {
  const t = await getT();
  const templates = await getTemplates();
  return (
    <div className="space-y-6">
      <div>
        <Link href="/services" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← {t("services.title")}
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <SectionTitle eyebrow={t("nav.section.plan")}>{t("templates.title")}</SectionTitle>
          <Link
            href="/services/templates/new"
            className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            {t("templates.newTemplate")}
          </Link>
        </div>
      </div>

      {templates.length === 0 ? (
        <Card className="px-5 py-10 text-center text-sm text-ink-500">
          {t("templates.empty")}
        </Card>
      ) : (
        <div className="space-y-2">
          {templates.map((tpl) => (
            <Link key={tpl.id} href={`/services/templates/${tpl.id}`} className="block">
              <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:border-white/20">
                <div>
                  <span className="font-medium text-ink-100">{tpl.name}</span>
                  <p className="mt-0.5 text-xs text-ink-500">{t("templates.defaultDuration", { min: tpl.default_duration_min })}</p>
                </div>
                <div className="text-xs text-ink-500">
                  {t("templates.sectionsCount", { count: tpl.item_count })} ·{" "}
                  {t("templates.rolesNeeded", { count: tpl.required_roles })}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-ink-600">
        {t("templates.footerNote")}
      </p>
    </div>
  );
}
