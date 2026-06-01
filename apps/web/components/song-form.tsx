"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createSong, updateSong, type SongFormState } from "@/app/(app)/songs/actions";
import type { Song } from "@sundayplan/shared";
import { useT } from "@/lib/i18n/client";

const initial: SongFormState = { error: null };

const input =
  "w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-gold-400/50";
const label = "mb-1 block text-xs font-medium text-ink-400";

const LANGS: { value: string; label: string }[] = [
  { value: "no", label: "Norsk" },
  { value: "en", label: "English" },
  { value: "sv", label: "Svenska" },
  { value: "da", label: "Dansk" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "pl", label: "Polski" },
];

function SongFields({ song }: { song?: Song }) {
  const t = useT();
  return (
    <>
      <div>
        <label className={label}>{t("songs.form.title")}</label>
        <input name="title" required defaultValue={song?.title ?? ""} placeholder={t("songs.form.titlePlaceholder")} className={input} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{t("songs.form.author")}</label>
          <input name="author" defaultValue={song?.author ?? ""} placeholder={t("songs.form.authorPlaceholder")} className={input} />
        </div>
        <div>
          <label className={label}>{t("songs.field.language")}</label>
          <select name="language" defaultValue={song?.language ?? "no"} className={input}>
            {LANGS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{t("songs.form.defaultKey")}</label>
          <input name="default_key" defaultValue={song?.default_key ?? ""} placeholder={t("songs.form.keyPlaceholder")} className={input} />
        </div>
        <div>
          <label className={label}>{t("songs.form.tempo")}</label>
          <input
            name="tempo_bpm"
            type="number"
            min={20}
            max={300}
            defaultValue={song?.tempo_bpm ?? ""}
            placeholder={t("songs.form.tempoPlaceholder")}
            className={input}
          />
        </div>
      </div>
      <div>
        <label className={label}>{t("songs.field.themes")}</label>
        <input
          name="themes"
          defaultValue={(song?.themes ?? []).join(", ")}
          placeholder={t("songs.form.themesPlaceholder")}
          className={input}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>{t("songs.field.ccli")}</label>
          <input name="ccli_song_id" defaultValue={song?.ccli_song_id ?? ""} placeholder={t("songs.form.optional")} className={input} />
        </div>
        <div>
          <label className={label}>{t("songs.field.tono")}</label>
          <input name="tono_work_id" defaultValue={song?.tono_work_id ?? ""} placeholder={t("songs.form.optional")} className={input} />
        </div>
      </div>
      <div>
        <label className={label}>{t("songs.form.chordChartUrl")}</label>
        <input name="chord_chart_url" type="url" defaultValue={song?.chord_chart_url ?? ""} placeholder="https://…" className={input} />
      </div>
      <div>
        <label className={label}>{t("songs.form.demoUrl")}</label>
        <input name="demo_url" type="url" defaultValue={song?.demo_url ?? ""} placeholder={t("songs.form.demoUrlPlaceholder")} className={input} />
      </div>
    </>
  );
}

function Actions({ pending, submitLabel, cancelHref }: { pending: boolean; submitLabel: string; cancelHref: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 pt-1">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? t("common.saving") : submitLabel}
      </button>
      <Link href={cancelHref} className="text-sm text-ink-500 hover:text-ink-300">
        {t("common.cancel")}
      </Link>
    </div>
  );
}

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-xs text-[color:var(--color-danger)]">{error}</p>;
}

export function AddSongForm() {
  const t = useT();
  const [state, action, pending] = useActionState(createSong, initial);
  return (
    <form action={action} className="space-y-4">
      <SongFields />
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel={t("songs.add")} cancelHref="/songs" />
    </form>
  );
}

export function EditSongForm({ song }: { song: Song }) {
  const t = useT();
  const bound = updateSong.bind(null, song.id);
  const [state, action, pending] = useActionState(bound, initial);
  return (
    <form action={action} className="space-y-4">
      <SongFields song={song} />
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel={t("common.save")} cancelHref={`/songs/${song.id}`} />
    </form>
  );
}
