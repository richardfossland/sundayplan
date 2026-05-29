import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, SectionTitle } from "@/components/ui";
import { TeamComposition } from "@/components/team-composition";
import { getTeam, getTeamRoles, teamInsights } from "@/lib/data/teams";
import { getChurchMemberOptions } from "@/lib/data/people";

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const team = await getTeam(id);
  if (!team) notFound();

  const [roles, memberOptions] = await Promise.all([
    getTeamRoles(id),
    getChurchMemberOptions(),
  ]);
  const insights = teamInsights(roles);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/teams" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← Teams
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <SectionTitle>{team.name}</SectionTitle>
          <Link
            href={`/teams/${id}/edit`}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            Edit
          </Link>
        </div>
        <p className="mt-2 text-sm text-ink-400">{team.description}</p>
      </div>

      {insights.length > 0 ? (
        <Card className="border-[color:var(--color-warning)]/25 px-5 py-4">
          <h2 className="text-sm font-semibold text-[color:var(--color-warning)]">Coverage warnings</h2>
          <ul className="mt-2 space-y-1 text-sm text-ink-300">
            {insights.map((i, k) => (
              <li key={k} className="flex gap-2">
                <span className="text-[color:var(--color-warning)]">!</span>
                {i}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <TeamComposition teamId={id} roles={roles} memberOptions={memberOptions} />
    </div>
  );
}
