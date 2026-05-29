"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { schemas } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";

export type SongFormState = { error: string | null };

function blankToUndef(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
}

function numOrUndef(v: FormDataEntryValue | null): number | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Themes are entered as a free-text comma list; normalise to a clean array. */
function parseThemes(v: FormDataEntryValue | null): string[] {
  if (typeof v !== "string") return [];
  return [
    ...new Set(
      v
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    ),
  ];
}

function parseSongForm(formData: FormData) {
  return schemas.SongInputSchema.safeParse({
    title: blankToUndef(formData.get("title")) ?? "",
    author: blankToUndef(formData.get("author")),
    ccli_song_id: blankToUndef(formData.get("ccli_song_id")),
    tono_work_id: blankToUndef(formData.get("tono_work_id")),
    default_key: blankToUndef(formData.get("default_key")),
    tempo_bpm: numOrUndef(formData.get("tempo_bpm")),
    language: blankToUndef(formData.get("language")) ?? "no",
    themes: parseThemes(formData.get("themes")),
    chord_chart_url: blankToUndef(formData.get("chord_chart_url")),
    demo_url: blankToUndef(formData.get("demo_url")),
  });
}

export async function createSong(
  _prev: SongFormState,
  formData: FormData,
): Promise<SongFormState> {
  const parsed = parseSongForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  const churchId = await getCurrentChurchId();
  if (!churchId) return { error: "No church found for your account." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("song")
    .insert({ ...parsed.data, church_id: churchId })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/songs");
  redirect(`/songs/${data.id}`);
}

export async function updateSong(
  id: string,
  _prev: SongFormState,
  formData: FormData,
): Promise<SongFormState> {
  const parsed = parseSongForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  const supabase = await createClient();
  // RLS (song_planner_all) scopes the update to the planner's church.
  const { error } = await supabase.from("song").update(parsed.data).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/songs");
  revalidatePath(`/songs/${id}`);
  redirect(`/songs/${id}`);
}
