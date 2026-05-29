import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, SectionTitle } from "@/components/ui";
import { SkillBadge, StatusBadge, shortDate } from "@/components/people";
import { getPerson, getPersonSchedule } from "@/lib/data/people";
import { setMemberStatus } from "@/app/(app)/people/actions";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  accepted: "success",
  pending: "warning",
  invited: "warning",
  no_response: "neutral",
  declined: "danger",
  removed: "neutral",
};

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await getPerson(id);
  if (!person) notFound();

  const schedule = await getPersonSchedule(id);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/people" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← People
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-royal-500 to-royal-700 text-base font-semibold text-gold-200">
              {person.name.charAt(0)}
            </div>
            <SectionTitle>{person.name}</SectionTitle>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/people/${id}/edit`}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
            >
              Edit
            </Link>
            {person.status === "archived" ? (
              <form action={setMemberStatus.bind(null, id, "active")}>
                <button className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-300 transition-colors hover:border-white/25">
                  Reactivate
                </button>
              </form>
            ) : (
              <form action={setMemberStatus.bind(null, id, "archived")}>
                <button className="rounded-lg border border-[color:var(--color-danger)]/30 px-3 py-1.5 text-sm text-[color:var(--color-danger)] transition-colors hover:border-[color:var(--color-danger)]/60">
                  Archive
                </button>
              </form>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SkillBadge skill={person.skill} />
          <StatusBadge status={person.status} />
          {person.teams.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="px-5 py-4 lg:col-span-1">
          <h2 className="text-sm font-semibold text-ink-100">Contact</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Phone</dt>
              <dd className="font-mono text-ink-200">{person.phone ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Preferred</dt>
              <dd className="uppercase text-ink-300">{person.channel}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Last served</dt>
              <dd className="tabular-nums text-ink-300">{shortDate(person.last_served)}</dd>
            </div>
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Upcoming assignments" sub={`${schedule.length} on the next four Sundays`} />
          {schedule.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-500">No upcoming assignments.</p>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {schedule.map((a, i) => (
                <li key={i} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <span className="text-sm text-ink-100">{a.role}</span>
                    <span className="ml-2 text-xs text-ink-500">{a.service_label}</span>
                  </div>
                  <Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{a.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
