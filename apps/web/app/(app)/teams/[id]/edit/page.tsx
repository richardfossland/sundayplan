import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, SectionTitle } from "@/components/ui";
import { EditTeamForm } from "@/components/team-form";
import { getTeam } from "@/lib/data/teams";

export default async function EditTeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const team = await getTeam(id);
  if (!team) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link
          href={`/teams/${id}`}
          className="text-xs text-ink-500 transition-colors hover:text-gold-400"
        >
          ← {team.name}
        </Link>
        <div className="mt-2">
          <SectionTitle eyebrow="Ministries">Edit team</SectionTitle>
        </div>
      </div>
      <Card className="px-5 py-5">
        <EditTeamForm team={team} />
      </Card>
    </div>
  );
}
