import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader, SectionTitle } from "@/components/ui";
import { EditTeamForm } from "@/components/team-form";
import { RoleRequiredCredentials } from "@/components/role-required-credentials";
import { getTeam, getTeamRoles } from "@/lib/data/teams";
import { getT } from "@/lib/i18n/server";

export default async function EditTeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const team = await getTeam(id);
  if (!team) notFound();

  const t = await getT();
  const roles = await getTeamRoles(id);

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
          <SectionTitle eyebrow={t("teams.eyebrow")}>{t("teams.editTeam")}</SectionTitle>
        </div>
      </div>
      <Card className="px-5 py-5">
        <EditTeamForm team={team} />
      </Card>

      <Card>
        <CardHeader title={t("teams.credGatingTitle")} sub={t("teams.credGatingSub")} />
        {roles.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-600">{t("teams.credGatingNoRoles")}</p>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {roles.map((role) => (
              <li key={role.id} className="px-5 py-4">
                <span className="text-sm font-medium text-ink-100">{role.role}</span>
                <RoleRequiredCredentials teamId={id} role={role} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
