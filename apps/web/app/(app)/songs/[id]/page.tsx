import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader } from "@/components/ui";
import { getSong } from "@/lib/data/songs";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-100">{value}</dd>
    </div>
  );
}

export default async function SongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const song = await getSong(id);
  if (!song) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/songs" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← Songs
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-ink-50">{song.title}</h1>
            {song.default_key ? <Badge tone="gold">{song.default_key}</Badge> : null}
          </div>
          <Link
            href={`/songs/${id}/edit`}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-white/25"
          >
            Edit
          </Link>
        </div>
        <p className="mt-2 text-sm text-ink-400">{song.author ?? "Unknown author"}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="px-5 py-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
            <Field label="Language" value={song.language} />
            <Field label="Tempo" value={song.tempo_bpm ? `${song.tempo_bpm} BPM` : "—"} />
            <Field
              label="Themes"
              value={
                song.themes.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {song.themes.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Field label="CCLI song #" value={song.ccli_song_id ?? "—"} />
            <Field label="TONO work ID" value={song.tono_work_id ?? "—"} />
            <Field
              label="Chord chart"
              value={
                song.chord_chart_url ? (
                  <a href={song.chord_chart_url} target="_blank" rel="noreferrer" className="text-gold-300 hover:underline">
                    Open chart →
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Field
              label="Demo"
              value={
                song.demo_url ? (
                  <a href={song.demo_url} target="_blank" rel="noreferrer" className="text-gold-300 hover:underline">
                    Listen / watch →
                  </a>
                ) : (
                  "—"
                )
              }
            />
          </dl>
        </Card>

        <aside>
          <Card>
            <CardHeader title="Service history" sub={`${song.history.length} uses`} />
            {song.history.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-ink-500">
                Not used in a service yet.
              </p>
            ) : (
              <ul className="divide-y divide-white/[0.05]">
                {song.history.map((h) => (
                  <li key={`${h.service_id}-${h.starts_at_utc}`} className="px-5 py-3">
                    <Link href={`/services/${h.service_id}`} className="text-sm text-ink-100 hover:text-gold-300">
                      {h.service_name}
                    </Link>
                    <p className="text-xs text-ink-500">{dateLabel(h.starts_at_utc)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
