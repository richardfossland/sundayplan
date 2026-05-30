/**
 * Setlist view data — the songs of a service in order, with the musical detail
 * a band needs (key, tempo, chord chart). Reads the order-of-service song items
 * (service_item.kind='song') joined to the song library, under the planner's
 * RLS. A focused, printable "what we're playing" view; the SundayStage bridge
 * (pushing this setlist out) stays deferred — it's an external integration.
 */
import { createClient } from "@/lib/supabase/server";

export interface SetlistEntry {
  position: number;
  label: string;
  title: string;
  author: string | null;
  key: string | null;
  tempo_bpm: number | null;
  themes: string[];
  ccli_song_id: string | null;
  chord_chart_url: string | null;
  notes: string | null;
}

export interface ServiceSetlist {
  service_id: string;
  name: string;
  starts_at_utc: string;
  state: string;
  songs: SetlistEntry[];
}

interface ItemEmbed {
  position: number;
  label: string;
  notes: string | null;
  song: {
    title: string;
    author: string | null;
    default_key: string | null;
    tempo_bpm: number | null;
    themes: string[] | null;
    ccli_song_id: string | null;
    chord_chart_url: string | null;
  } | null;
}

export async function getServiceSetlist(serviceId: string): Promise<ServiceSetlist | null> {
  const supabase = await createClient();

  const { data: service, error: svcErr } = await supabase
    .from("service")
    .select("id, name, starts_at_utc, state")
    .eq("id", serviceId)
    .maybeSingle();
  if (svcErr) throw svcErr;
  if (!service) return null;

  const { data: items, error: itemErr } = await supabase
    .from("service_item")
    .select(
      "position, label, notes, song:song_id(title, author, default_key, tempo_bpm, themes, ccli_song_id, chord_chart_url)",
    )
    .eq("service_id", serviceId)
    .eq("kind", "song")
    .not("song_id", "is", null)
    .order("position");
  if (itemErr) throw itemErr;

  const songs: SetlistEntry[] = ((items ?? []) as unknown as ItemEmbed[])
    .filter((it) => it.song)
    .map((it) => ({
      position: it.position,
      label: it.label,
      title: it.song!.title,
      author: it.song!.author,
      key: it.song!.default_key,
      tempo_bpm: it.song!.tempo_bpm,
      themes: it.song!.themes ?? [],
      ccli_song_id: it.song!.ccli_song_id,
      chord_chart_url: it.song!.chord_chart_url,
      notes: it.notes,
    }));

  return {
    service_id: service.id as string,
    name: service.name as string,
    starts_at_utc: service.starts_at_utc as string,
    state: service.state as string,
    songs,
  };
}
