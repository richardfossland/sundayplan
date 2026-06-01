import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { AddMemberForm } from "@/components/member-form";
import { getT } from "@/lib/i18n/server";

export default async function NewPersonPage() {
  const t = await getT();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href="/people" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← {t("people.title")}
        </Link>
        <div className="mt-2">
          <SectionTitle eyebrow={t("people.eyebrowRegistry")}>{t("people.addAPerson")}</SectionTitle>
        </div>
        <p className="mt-2 text-sm text-ink-400">{t("people.newPersonHint")}</p>
      </div>
      <Card className="px-5 py-5">
        <AddMemberForm />
      </Card>
    </div>
  );
}
