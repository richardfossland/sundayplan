import Link from "next/link";
import { listTemplates } from "@/lib/data/comms";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

const CHANNEL_TONE = { sms: "gold", email: "info", push: "success" } as const;

export default async function TemplatesPage() {
  const t = await getT();
  const templates = await listTemplates();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow={t("messages.eyebrow")}>{t("messages.templates.title")}</SectionTitle>
        <div className="flex items-center gap-3">
          <Link
            href="/messages"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            {t("messages.templates.history")}
          </Link>
          <Link
            href="/messages/templates/new"
            className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            {t("messages.templates.new")}
          </Link>
        </div>
      </div>

      {templates.length === 0 ? (
        <Card className="px-5 py-10 text-center text-sm text-ink-500">
          {t("messages.templates.empty")}
        </Card>
      ) : (
        <div className="space-y-2">
          {templates.map((tpl) => (
            <Link key={tpl.id} href={`/messages/templates/${tpl.id}/edit`} className="block">
              <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:border-white/20">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink-100">{tpl.name}</span>
                    <Badge tone={CHANNEL_TONE[tpl.channel]}>{tpl.channel}</Badge>
                    {!tpl.is_active ? <Badge tone="neutral">{t("messages.templates.inactive")}</Badge> : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-500">{tpl.body}</p>
                </div>
                <span className="text-xs text-ink-500">
                  {t("messages.templates.meta", {
                    purpose: tpl.purpose.replace("_", " "),
                    language: tpl.language,
                  })}
                </span>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-ink-600">
        {t("messages.templates.footer.pre")}
        <Link href="/messages" className="text-ink-400 hover:text-gold-300">
          {t("messages.templates.footer.link")}
        </Link>
        {t("messages.templates.footer.post")}
      </p>
    </div>
  );
}
