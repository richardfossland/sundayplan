import Link from "next/link";
import { SectionTitle } from "@/components/ui";
import { TeamCard } from "@/components/teams";
import { getTeams } from "@/lib/data/teams";

export default async function TeamsPage() {
  const teams = await getTeams();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow="Ministries">Teams</SectionTitle>
        <Link
          href="/teams/new"
          className="rounded-lg bg-gold-400 px-3 py-1.5 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90"
        >
          + New team
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {teams.map((t) => (
          <TeamCard key={t.id} team={t} />
        ))}
      </div>
    </div>
  );
}
