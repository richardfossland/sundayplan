import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, SectionTitle } from "@/components/ui";
import { EditMemberForm } from "@/components/member-form";
import { getMemberEditable } from "@/lib/data/people";
import { getT } from "@/lib/i18n/server";

export default async function EditPersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await getT();
  const { id } = await params;
  const member = await getMemberEditable(id);
  if (!member) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link
          href={`/people/${id}`}
          className="text-xs text-ink-500 transition-colors hover:text-gold-400"
        >
          ← {member.display_name}
        </Link>
        <div className="mt-2">
          <SectionTitle eyebrow={t("people.eyebrowRegistry")}>{t("people.editPerson")}</SectionTitle>
        </div>
      </div>
      <Card className="px-5 py-5">
        <EditMemberForm member={member} />
      </Card>
    </div>
  );
}
