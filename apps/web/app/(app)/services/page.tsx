import Link from "next/link";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { getServices, type ServiceSummary } from "@/lib/data/services";
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

function FillStatus({ s }: { s: ServiceSummary }) {
  if (s.required_roles) {
    const complete = s.filled_roles >= s.required_roles;
    return (
      <span className={complete ? "text-[color:var(--color-success)]" : "text-ink-300"}>
        {s.filled_roles}/{s.required_roles} roles
      </span>
    );
  }
  return (
    <span className="text-ink-400">
      {s.filled_roles} {s.filled_roles === 1 ? "role" : "roles"} filled
    </span>
  );
}

export default async function ServicesPage() {
  const services = await getServices();
  const upcoming = services.filter((s) => new Date(s.starts_at_utc) >= new Date()).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow="Plan">Services</SectionTitle>
        <div className="flex items-center gap-4">
          <span className="text-sm text-ink-500">
            {upcoming} upcoming · {services.length} total
          </span>
          <Link
            href="/services/calendar"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            Calendar
          </Link>
          <Link
            href="/services/templates"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            Templates
          </Link>
          <Link
            href="/services/new"
            className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
          >
            + New service
          </Link>
        </div>
      </div>

      {services.length === 0 ? (
        <Card className="px-5 py-10 text-center text-sm text-ink-500">
          No services yet. Create your first one to start building the order of service.
        </Card>
      ) : (
        <div className="space-y-2">
          {services.map((s) => (
            <Link key={s.id} href={`/services/${s.id}`} className="block">
              <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:border-white/20">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink-100">{s.name}</span>
                    <Badge tone={STATE_TONE[s.state]}>{s.state}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">{formatWhen(s.starts_at_utc)}</p>
                </div>
                <div className="flex items-center gap-5 text-xs">
                  <span className="text-ink-500">
                    {s.item_count} {s.item_count === 1 ? "item" : "items"}
                    {s.total_duration_min > 0 ? ` · ${s.total_duration_min} min` : ""}
                  </span>
                  <FillStatus s={s} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-ink-600">
        Fill status counts roles with an active assignment. Assign people on the{" "}
        <Link href="/schedule" className="text-ink-400 hover:text-gold-300">
          schedule grid
        </Link>
        .
      </p>
    </div>
  );
}
