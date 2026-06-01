import Link from "next/link";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { getServices, type ServiceSummary } from "@/lib/data/services";
import { getT, type TFn } from "@/lib/i18n/server";
import type { ServiceState } from "@sundayplan/shared";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${hh}:${mm}`;
}

const STATE_TONE: Record<ServiceState, "neutral" | "success" | "warning" | "info"> = {
  draft: "neutral",
  published: "success",
  in_progress: "warning",
  played: "info",
  archived: "neutral",
};

function FillStatus({ s, t }: { s: ServiceSummary; t: TFn }) {
  if (s.required_roles) {
    const complete = s.filled_roles >= s.required_roles;
    return (
      <span className={complete ? "text-[color:var(--color-success)]" : "text-ink-300"}>
        {t("services.rolesCount", { filled: s.filled_roles, required: s.required_roles })}
      </span>
    );
  }
  return (
    <span className="text-ink-400">
      {t("services.rolesFilled", { count: s.filled_roles })}
    </span>
  );
}

export default async function ServicesPage() {
  const t = await getT();
  const services = await getServices();
  const upcoming = services.filter((s) => new Date(s.starts_at_utc) >= new Date()).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow={t("nav.section.plan")}>{t("services.title")}</SectionTitle>
        <div className="flex items-center gap-4">
          <span className="text-sm text-ink-500">
            {t("services.countSummary", { upcoming, total: services.length })}
          </span>
          <Link
            href="/services/calendar"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            {t("services.calendar")}
          </Link>
          <Link
            href="/services/templates"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            {t("services.templates")}
          </Link>
          <Link
            href="/services/new"
            className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            {t("services.newService")}
          </Link>
        </div>
      </div>

      {services.length === 0 ? (
        <Card className="px-5 py-10 text-center text-sm text-ink-500">
          {t("services.empty")}
        </Card>
      ) : (
        <div className="space-y-2">
          {services.map((s) => (
            <Link key={s.id} href={`/services/${s.id}`} className="block">
              <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:border-white/20">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink-100">{s.name}</span>
                    <Badge tone={STATE_TONE[s.state]}>{t(`services.state.${s.state}`)}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">{formatWhen(s.starts_at_utc)}</p>
                </div>
                <div className="flex items-center gap-5 text-xs">
                  <span className="text-ink-500">
                    {t("services.itemsCount", { count: s.item_count })}
                    {s.total_duration_min > 0 ? ` · ${t("services.minutes", { min: s.total_duration_min })}` : ""}
                  </span>
                  <FillStatus s={s} t={t} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-ink-600">
        {t("services.fillNote.before")}{" "}
        <Link href="/schedule" className="text-ink-400 hover:text-gold-300">
          {t("services.fillNote.link")}
        </Link>
        {t("services.fillNote.after")}
      </p>
    </div>
  );
}
