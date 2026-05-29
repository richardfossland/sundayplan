import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { AddSongForm } from "@/components/song-form";

export default function NewSongPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href="/songs" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← Songs
        </Link>
        <div className="mt-2">
          <SectionTitle eyebrow="Library">Add song</SectionTitle>
        </div>
      </div>
      <Card className="px-5 py-5">
        <AddSongForm />
      </Card>
    </div>
  );
}
