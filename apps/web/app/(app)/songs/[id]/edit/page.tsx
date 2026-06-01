import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, SectionTitle } from "@/components/ui";
import { EditSongForm } from "@/components/song-form";
import { getSongEditable } from "@/lib/data/songs";
import { getT } from "@/lib/i18n/server";

export default async function EditSongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getT();
  const song = await getSongEditable(id);
  if (!song) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href={`/songs/${id}`} className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← {song.title}
        </Link>
        <div className="mt-2">
          <SectionTitle eyebrow={t("songs.eyebrow")}>{t("songs.editTitle")}</SectionTitle>
        </div>
      </div>
      <Card className="px-5 py-5">
        <EditSongForm song={song} />
      </Card>
    </div>
  );
}
