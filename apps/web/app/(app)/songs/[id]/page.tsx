import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader } from "@/components/ui";
import { getSong } from "@/lib/data/songs";
import { getT, getLocale } from "@/lib/i18n/server";
import { formatDateCompact } from "@/lib/i18n/date";

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
  const [t, locale, song] = await Promise.all([getT(), getLocale(), getSong(id)]);
  if (!song) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/songs" className="text-xs text-ink-500 transition-colors hover:text-gold-400">
          ← {t("songs.title")}
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
            {t("common.edit")}
          </Link>
        </div>
        <p className="mt-2 text-sm text-ink-400">{song.author ?? t("songs.unknownAuthor")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="px-5 py-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
            <Field label={t("songs.field.language")} value={song.language} />
            <Field label={t("songs.field.tempo")} value={song.tempo_bpm ? `${song.tempo_bpm} BPM` : "—"} />
            <Field
              label={t("songs.field.themes")}
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
            <Field label={t("songs.field.ccli")} value={song.ccli_song_id ?? "—"} />
            <Field label={t("songs.field.tono")} value={song.tono_work_id ?? "—"} />
            <Field
              label={t("songs.field.chordChart")}
              value={
                song.chord_chart_url ? (
                  <a href={song.chord_chart_url} target="_blank" rel="noreferrer" className="text-gold-300 hover:underline">
                    {t("songs.openChart")}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Field
              label={t("songs.field.demo")}
              value={
                song.demo_url ? (
                  <a href={song.demo_url} target="_blank" rel="noreferrer" className="text-gold-300 hover:underline">
                    {t("songs.listenWatch")}
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
            <CardHeader title={t("songs.history.title")} sub={t("songs.history.uses", { count: song.history.length })} />
            {song.history.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-ink-500">
                {t("songs.history.empty")}
              </p>
            ) : (
              <ul className="divide-y divide-white/[0.05]">
                {song.history.map((h) => (
                  <li key={`${h.service_id}-${h.starts_at_utc}`} className="px-5 py-3">
                    <Link href={`/services/${h.service_id}`} className="text-sm text-ink-100 hover:text-gold-300">
                      {h.service_name}
                    </Link>
                    <p className="text-xs text-ink-500">{formatDateCompact(h.starts_at_utc, locale)}</p>
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
