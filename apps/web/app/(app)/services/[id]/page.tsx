import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader } from "@/components/ui";
import { ServiceEditor } from "@/components/service-editor";
import { SendToStageButton } from "@/components/send-to-stage-button";
import { getService, type ServiceAssignmentRow } from "@/lib/data/services";
import { getSongOptions } from "@/lib/data/songs";
import { getT, getLocale, type TFn } from "@/lib/i18n/server";
import { formatWhenLong } from "@/lib/i18n/date";
import type { ServiceState } from "@sundayplan/shared";

const STATE_TONE: Record<ServiceState, "neutral" | "success" | "warning" | "info"> = {
  draft: "neutral",
  published: "success",
  in_progress: "warning",
  played: "info",
  archived: "neutral",
};

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  accepted: "success",
  invited: "info",
  pending: "warning",
  no_response: "warning",
  declined: "danger",
};

function AssignmentList({ assignments, t }: { assignments: ServiceAssignmentRow[]; t: TFn }) {
  if (assignments.length === 0) {
    return (
      <p className="px-5 py-6 text-center text-sm text-ink-500">
        {t("services.noOneAssigned")}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-white/[0.05]">
      {assignments.map((a) => (
        <li key={a.id} className="flex items-start justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm text-ink-100">{a.member_name}</p>
            <p className="text-xs text-ink-500">{a.role_name}</p>
            {a.response_note ? (
              <p className="mt-1 text-xs italic text-ink-400">“{a.response_note}”</p>
            ) : null}
          </div>
          <Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{t(`services.assignmentStatus.${a.status}`)}</Badge>
        </li>
      ))}
    </ul>
  );
}

export default async function ServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, locale, service, songs] = await Promise.all([
    getT(),
    getLocale(),
    getService(id),
    getSongOptions(),
  ]);
  if (!service) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/services" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← {t("services.title")}
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-ink-50">{service.name}</h1>
            <Badge tone={STATE_TONE[service.state]}>{t(`services.state.${service.state}`)}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/services/${id}/setlist`}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
            >
              {t("services.setlist")}
            </Link>
            <Link
              href={`/services/${id}/edit`}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
            >
              {t("common.edit")}
            </Link>
            <SendToStageButton serviceId={id} />
          </div>
        </div>
        <p className="mt-2 text-sm text-ink-400">
          {formatWhenLong(service.starts_at_utc, locale)}
          {service.template_name ? (
            <span className="text-ink-600"> · {t("services.fromTemplate", { name: service.template_name })}</span>
          ) : null}
        </p>
        {service.notes ? (
          <p className="mt-3 max-w-2xl rounded-lg border border-white/[0.06] bg-ink-900/40 px-4 py-3 text-sm text-ink-300">
            {service.notes}
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-tight text-ink-100">{t("services.orderOfService")}</h2>
          <ServiceEditor serviceId={service.id} items={service.items} songs={songs} />
        </section>

        <aside className="space-y-3">
          <Card>
            <CardHeader
              title={t("services.assignments")}
              sub={t("services.placedCount", { count: service.assignments.length })}
            />
            <AssignmentList assignments={service.assignments} t={t} />
          </Card>
          <Link
            href="/schedule"
            className="block rounded-lg border border-white/10 px-4 py-2 text-center text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            {t("services.fillRoles")} →
          </Link>
        </aside>
      </div>
    </div>
  );
}
