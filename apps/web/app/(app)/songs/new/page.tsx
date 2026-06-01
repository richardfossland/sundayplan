import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { AddSongForm } from "@/components/song-form";
import { getT } from "@/lib/i18n/server";

export default async function NewSongPage() {
  const t = await getT();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href="/songs" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← {t("songs.title")}
        </Link>
        <div className="mt-2">
          <SectionTitle eyebrow={t("songs.eyebrow")}>{t("songs.addTitle")}</SectionTitle>
        </div>
      </div>
      <Card className="px-5 py-5">
        <AddSongForm />
      </Card>
    </div>
  );
}
