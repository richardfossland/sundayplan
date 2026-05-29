"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createSong, updateSong, type SongFormState } from "@/app/(app)/songs/actions";
import type { Song } from "@sundayplan/shared";

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
  return (
    <>
      <div>
        <label className={label}>Title</label>
        <input name="title" required defaultValue={song?.title ?? ""} placeholder="Song title" className={input} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Author</label>
          <input name="author" defaultValue={song?.author ?? ""} placeholder="Writer / artist" className={input} />
        </div>
        <div>
          <label className={label}>Language</label>
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
          <label className={label}>Default key</label>
          <input name="default_key" defaultValue={song?.default_key ?? ""} placeholder="e.g. G" className={input} />
        </div>
        <div>
          <label className={label}>Tempo (BPM)</label>
          <input
            name="tempo_bpm"
            type="number"
            min={20}
            max={300}
            defaultValue={song?.tempo_bpm ?? ""}
            placeholder="e.g. 72"
            className={input}
          />
        </div>
      </div>
      <div>
        <label className={label}>Themes</label>
        <input
          name="themes"
          defaultValue={(song?.themes ?? []).join(", ")}
          placeholder="grace, christmas, communion (comma-separated)"
          className={input}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>CCLI song #</label>
          <input name="ccli_song_id" defaultValue={song?.ccli_song_id ?? ""} placeholder="optional" className={input} />
        </div>
        <div>
          <label className={label}>TONO work ID</label>
          <input name="tono_work_id" defaultValue={song?.tono_work_id ?? ""} placeholder="optional" className={input} />
        </div>
      </div>
      <div>
        <label className={label}>Chord chart URL</label>
        <input name="chord_chart_url" type="url" defaultValue={song?.chord_chart_url ?? ""} placeholder="https://…" className={input} />
      </div>
      <div>
        <label className={label}>Demo URL</label>
        <input name="demo_url" type="url" defaultValue={song?.demo_url ?? ""} placeholder="https://… (mp3 / video)" className={input} />
      </div>
    </>
  );
}

function Actions({ pending, submitLabel, cancelHref }: { pending: boolean; submitLabel: string; cancelHref: string }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
      <Link href={cancelHref} className="text-sm text-ink-500 hover:text-ink-300">
        Cancel
      </Link>
    </div>
  );
}

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-xs text-[color:var(--color-danger)]">{error}</p>;
}

export function AddSongForm() {
  const [state, action, pending] = useActionState(createSong, initial);
  return (
    <form action={action} className="space-y-4">
      <SongFields />
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel="Add song" cancelHref="/songs" />
    </form>
  );
}

export function EditSongForm({ song }: { song: Song }) {
  const bound = updateSong.bind(null, song.id);
  const [state, action, pending] = useActionState(bound, initial);
  return (
    <form action={action} className="space-y-4">
      <SongFields song={song} />
      <ErrorNote error={state.error} />
      <Actions pending={pending} submitLabel="Save changes" cancelHref={`/songs/${song.id}`} />
    </form>
  );
}
