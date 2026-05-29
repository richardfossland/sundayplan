import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { AddTeamForm } from "@/components/team-form";

export default function NewTeamPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href="/teams" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← Teams
        </Link>
        <div className="mt-2">
          <SectionTitle eyebrow="Ministries">New team</SectionTitle>
        </div>
        <p className="mt-2 text-sm text-ink-400">
          Group volunteers by ministry — worship, tech, hospitality, and more.
        </p>
      </div>
      <Card className="px-5 py-5">
        <AddTeamForm />
      </Card>
    </div>
  );
}
