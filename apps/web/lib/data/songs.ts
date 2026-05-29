/**
 * Songs data layer — the light song library (metadata + file links, not slide
 * content; SundayStage owns the slides). Real Supabase queries under the
 * planner's RLS, scoped to their church.
 *
 * "Last used" is derived from actual usage — service_items and setlist_songs
 * that reference the song, joined to their service's date — rather than the
 * denormalized song.last_used_at column, which nothing maintains yet. That
 * makes the "not used in 8+ weeks" filter honest the moment a song is attached
 * to a service.
 */
import type { Song } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/server";

/** Songs unused for at least this long count as "stale" / rotation candidates. */
export const STALE_DAYS = 56; // 8 weeks

export interface SongSummary {
  id: string;
  title: string;
  author: string | null;
  default_key: string | null;
  language: string;
  themes: string[];
  last_used_at: string | null; // computed from real usage, ISO or null
  usage_count: number;
}

export interface SongFilters {
  q?: string;
  theme?: string;
  language?: string;
  stale?: boolean;
}

interface SongRow {
  id: string;
  title: string;
  author: string | null;
  default_key: string | null;
  language: string;
  themes: string[] | null;
}

/** song_id → { last ISO date used, count } across services. */
async function usageBySong(): Promise<Map<string, { last: string | null; count: number }>> {
  const supabase = await createClient();
  const [items, setlist] = await Promise.all([
    supabase
      .from("service_item")
      .select("song_id, service(starts_at_utc)")
      .not("song_id", "is", null),
    supabase
      .from("setlist_song")
      .select("song_id, setlist(service(starts_at_utc))"),
  ]);
  if (items.error) throw items.error;
  if (setlist.error) throw setlist.error;

  const map = new Map<string, { last: string | null; count: number }>();
  const bump = (songId: string | null | undefined, date: string | null | undefined) => {
    if (!songId) return;
    const cur = map.get(songId) ?? { last: null, count: 0 };
    cur.count += 1;
    if (date && (!cur.last || date > cur.last)) cur.last = date;
    map.set(songId, cur);
  };

  interface ItemUsage { song_id: string | null; service: { starts_at_utc: string } | null }
  for (const r of (items.data ?? []) as unknown as ItemUsage[]) {
    bump(r.song_id, r.service?.starts_at_utc);
  }
  interface SetlistUsage {
    song_id: string | null;
    setlist: { service: { starts_at_utc: string } | null } | null;
  }
  for (const r of (setlist.data ?? []) as unknown as SetlistUsage[]) {
    bump(r.song_id, r.setlist?.service?.starts_at_utc);
  }
  return map;
}

/** Songs in the church, filtered, with computed usage. Title order. */
export async function getSongs(filters: SongFilters = {}): Promise<SongSummary[]> {
  const supabase = await createClient();
  let query = supabase
    .from("song")
    .select("id, title, author, default_key, language, themes")
    .order("title");

  if (filters.q) query = query.or(`title.ilike.%${filters.q}%,author.ilike.%${filters.q}%`);
  if (filters.language) query = query.eq("language", filters.language);
  if (filters.theme) query = query.contains("themes", [filters.theme]);

  const [{ data, error }, usage] = await Promise.all([query, usageBySong()]);
  if (error) throw error;

  const staleBefore = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  const rows = ((data ?? []) as unknown as SongRow[]).map((s) => {
    const u = usage.get(s.id);
    return {
      id: s.id,
      title: s.title,
      author: s.author,
      default_key: s.default_key,
      language: s.language,
      themes: s.themes ?? [],
      last_used_at: u?.last ?? null,
      usage_count: u?.count ?? 0,
    };
  });

  if (filters.stale) {
    return rows.filter(
      (s) => s.last_used_at === null || new Date(s.last_used_at).getTime() < staleBefore,
    );
  }
  return rows;
}

/** Distinct themes across the church's songs — drives the theme filter. */
export async function getSongThemes(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("song").select("themes");
  if (error) throw error;
  const set = new Set<string>();
  for (const row of (data ?? []) as { themes: string[] | null }[]) {
    for (const t of row.themes ?? []) set.add(t);
  }
  return [...set].sort();
}

export interface SongServiceUse {
  service_id: string;
  service_name: string;
  starts_at_utc: string;
}

export interface SongDetail extends Song {
  history: SongServiceUse[];
}

/** One song with its service history (where it's been used), newest first. */
export async function getSong(id: string): Promise<SongDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("song").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: uses, error: usesErr } = await supabase
    .from("service_item")
    .select("service(id, name, starts_at_utc)")
    .eq("song_id", id);
  if (usesErr) throw usesErr;

  interface UseRow { service: { id: string; name: string; starts_at_utc: string } | null }
  const history: SongServiceUse[] = ((uses ?? []) as unknown as UseRow[])
    .filter((u) => u.service)
    .map((u) => ({
      service_id: u.service!.id,
      service_name: u.service!.name,
      starts_at_utc: u.service!.starts_at_utc,
    }))
    .sort((a, b) => b.starts_at_utc.localeCompare(a.starts_at_utc));

  return { ...(data as Song), history };
}

/** Editable fields for the edit form. */
export async function getSongEditable(id: string): Promise<Song | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("song").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Song | null) ?? null;
}

export interface SongOption {
  id: string;
  title: string;
  default_key: string | null;
}

/** Lightweight list for the service-item song picker. */
export async function getSongOptions(): Promise<SongOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("song")
    .select("id, title, default_key")
    .order("title");
  if (error) throw error;
  return (data ?? []) as SongOption[];
}
