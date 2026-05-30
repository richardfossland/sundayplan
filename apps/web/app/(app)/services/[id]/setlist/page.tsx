import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { getServiceSetlist } from "@/lib/data/setlist";

export default async function SetlistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const setlist = await getServiceSetlist(id);
  if (!setlist) notFound();

  const date = setlist.starts_at_utc.slice(0, 10);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionTitle eyebrow="Setlist">{setlist.name}</SectionTitle>
          <p className="mt-1 text-sm text-ink-500">
            {date} · {setlist.songs.length} song{setlist.songs.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link href={`/services/${id}`} className="text-sm text-ink-500 hover:text-ink-300">
          ← Service
        </Link>
      </div>

      {setlist.songs.length === 0 ? (
        <p className="py-12 text-center text-sm text-ink-500">
          No songs attached yet. Add <strong className="text-ink-300">song</strong> items to the
          order of service and link them to the song library.
        </p>
      ) : (
        <ol className="space-y-3">
          {setlist.songs.map((s, i) => (
            <Card key={s.position} className="px-5 py-4">
              <div className="flex items-start gap-4">
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink-600">{i + 1}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-base font-semibold text-ink-50">{s.title}</span>
                    {s.author ? <span className="text-sm text-ink-500">{s.author}</span> : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-400">
                    {s.key ? <Badge tone="gold">Key {s.key}</Badge> : null}
                    {s.tempo_bpm ? <Badge tone="info">{s.tempo_bpm} bpm</Badge> : null}
                    {s.themes.map((t) => (
                      <span key={t} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[0.7rem]">
                        {t}
                      </span>
                    ))}
                  </div>
                  {s.notes ? <p className="mt-2 text-sm text-ink-400">{s.notes}</p> : null}
                  {s.chord_chart_url ? (
                    <a
                      href={s.chord_chart_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-xs text-gold-300 hover:text-gold-200"
                    >
                      Chord chart →
                    </a>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </ol>
      )}

      <p className="text-center text-xs text-ink-600">
        Pushing this setlist to SundayStage is a planned integration (Phase 10).
      </p>
    </div>
  );
}
