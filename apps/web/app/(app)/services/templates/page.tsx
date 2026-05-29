import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { getTemplates } from "@/lib/data/templates";

export default async function TemplatesPage() {
  const templates = await getTemplates();
  return (
    <div className="space-y-6">
      <div>
        <Link href="/services" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← Services
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <SectionTitle eyebrow="Plan">Service templates</SectionTitle>
          <Link
            href="/services/templates/new"
            className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            + New template
          </Link>
        </div>
      </div>

      {templates.length === 0 ? (
        <Card className="px-5 py-10 text-center text-sm text-ink-500">
          No templates yet. A template is the reusable shape of a service — its default order and the roles it needs.
        </Card>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <Link key={t.id} href={`/services/templates/${t.id}`} className="block">
              <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:border-white/20">
                <div>
                  <span className="font-medium text-ink-100">{t.name}</span>
                  <p className="mt-0.5 text-xs text-ink-500">{t.default_duration_min} min default</p>
                </div>
                <div className="text-xs text-ink-500">
                  {t.item_count} {t.item_count === 1 ? "section" : "sections"} ·{" "}
                  {t.required_roles} {t.required_roles === 1 ? "role" : "roles"} needed
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-ink-600">
        Creating a service from a template copies its order of service and inherits its role requirements.
      </p>
    </div>
  );
}
