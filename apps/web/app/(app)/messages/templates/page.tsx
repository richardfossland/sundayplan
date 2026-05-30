import Link from "next/link";
import { listTemplates } from "@/lib/data/comms";
import { Badge, Card, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

const CHANNEL_TONE = { sms: "gold", email: "info", push: "success" } as const;

export default async function TemplatesPage() {
  const templates = await listTemplates();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow="Communications">Message templates</SectionTitle>
        <div className="flex items-center gap-3">
          <Link
            href="/messages"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            Message history
          </Link>
          <Link
            href="/messages/templates/new"
            className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            + New template
          </Link>
        </div>
      </div>

      {templates.length === 0 ? (
        <Card className="px-5 py-10 text-center text-sm text-ink-500">
          No templates yet. Create a reusable invite or reminder to send to a service&apos;s volunteers.
        </Card>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <Link key={t.id} href={`/messages/templates/${t.id}/edit`} className="block">
              <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:border-white/20">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink-100">{t.name}</span>
                    <Badge tone={CHANNEL_TONE[t.channel]}>{t.channel}</Badge>
                    {!t.is_active ? <Badge tone="neutral">inactive</Badge> : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-500">{t.body}</p>
                </div>
                <span className="text-xs text-ink-500">
                  {t.purpose.replace("_", " ")} · {t.language}
                </span>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-ink-600">
        Templates are the reusable invites + reminders. Compose a one-off send from the{" "}
        <Link href="/messages" className="text-ink-400 hover:text-gold-300">
          message history
        </Link>{" "}
        page.
      </p>
    </div>
  );
}
