import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader, SectionTitle } from "@/components/ui";
import { SkillBadge } from "@/components/people";
import { buildTeamInsights, buildTeamRoles, buildTeams, getTeam } from "@/lib/mock";

export function generateStaticParams() {
  return buildTeams().map((t) => ({ id: t.id }));
}

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const team = getTeam(id);
  if (!team) notFound();

  const roles = buildTeamRoles(id);
  const insights = buildTeamInsights(id);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/teams" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← Teams
        </Link>
        <div className="mt-2">
          <SectionTitle>{team.name}</SectionTitle>
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

      <Card>
        <CardHeader title="Roles" sub={`${roles.length} positions on this team`} />
        <ul className="divide-y divide-white/[0.05]">
          {roles.map((g) => (
            <li key={g.role} className="px-5 py-4">
              <div className="text-sm font-medium text-ink-100">{g.role}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {g.members.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-2 rounded-full bg-white/[0.04] py-1 pl-3 pr-1.5 text-sm text-ink-200">
                    <Link href={`/people/${m.id}`} className="hover:text-gold-300">{m.name}</Link>
                    <SkillBadge skill={m.skill} />
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
