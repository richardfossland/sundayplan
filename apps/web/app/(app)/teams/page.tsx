import { SectionTitle } from "@/components/ui";
import { TeamCard } from "@/components/teams";
import { getTeams } from "@/lib/data/teams";

export default async function TeamsPage() {
  const teams = await getTeams();
  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Ministries">Teams</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {teams.map((t) => (
          <TeamCard key={t.id} team={t} />
        ))}
      </div>
    </div>
  );
}
