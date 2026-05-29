import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader } from "@/components/ui";
import { ServiceEditor } from "@/components/service-editor";
import { getService, type ServiceAssignmentRow } from "@/lib/data/services";
import { getSongOptions } from "@/lib/data/songs";
import type { ServiceState } from "@sundayplan/shared";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${hh}:${mm}`;
}

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

function AssignmentList({ assignments }: { assignments: ServiceAssignmentRow[] }) {
  if (assignments.length === 0) {
    return (
      <p className="px-5 py-6 text-center text-sm text-ink-500">
        No one assigned yet.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-white/[0.05]">
      {assignments.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm text-ink-100">{a.member_name}</p>
            <p className="text-xs text-ink-500">{a.role_name}</p>
          </div>
          <Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{a.status.replace("_", " ")}</Badge>
        </li>
      ))}
    </ul>
  );
}

export default async function ServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await getService(id);
  if (!service) notFound();
  const songs = await getSongOptions();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/services" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← Services
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-ink-50">{service.name}</h1>
            <Badge tone={STATE_TONE[service.state]}>{service.state}</Badge>
          </div>
          <Link
            href={`/services/${id}/edit`}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            Edit
          </Link>
        </div>
        <p className="mt-2 text-sm text-ink-400">
          {formatWhen(service.starts_at_utc)}
          {service.template_name ? (
            <span className="text-ink-600"> · from {service.template_name}</span>
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
          <h2 className="text-sm font-semibold tracking-tight text-ink-100">Order of service</h2>
          <ServiceEditor serviceId={service.id} items={service.items} songs={songs} />
        </section>

        <aside className="space-y-3">
          <Card>
            <CardHeader
              title="Assignments"
              sub={`${service.assignments.length} placed`}
            />
            <AssignmentList assignments={service.assignments} />
          </Card>
          <Link
            href="/schedule"
            className="block rounded-lg border border-white/10 px-4 py-2 text-center text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            Fill roles on the schedule →
          </Link>
        </aside>
      </div>
    </div>
  );
}
