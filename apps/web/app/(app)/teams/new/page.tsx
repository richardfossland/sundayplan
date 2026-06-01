import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { AddTeamForm } from "@/components/team-form";
import { getT } from "@/lib/i18n/server";

export default async function NewTeamPage() {
  const t = await getT();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href="/teams" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← {t("teams.title")}
        </Link>
        <div className="mt-2">
          <SectionTitle eyebrow={t("teams.eyebrow")}>{t("teams.newTitle")}</SectionTitle>
        </div>
        <p className="mt-2 text-sm text-ink-400">
          {t("teams.newHint")}
        </p>
      </div>
      <Card className="px-5 py-5">
        <AddTeamForm />
      </Card>
    </div>
  );
}
