/**
 * Global search data layer — powers the ⌘K command palette. One light `ilike`
 * probe per entity (people / songs / services), all under the planner's RLS so
 * results never cross the church boundary. Capped per group to stay snappy.
 */
import { createClient } from "@/lib/supabase/server";

export interface SearchResults {
  people: { id: string; name: string }[];
  songs: { id: string; title: string; author: string | null }[];
  services: { id: string; name: string }[];
}

const EMPTY: SearchResults = { people: [], songs: [], services: [] };
const LIMIT = 6;

export async function search(query: string): Promise<SearchResults> {
  const q = query.trim();
  if (q.length < 2) return EMPTY;
  const supabase = await createClient();
  const like = `%${q}%`;

  const [people, songs, services] = await Promise.all([
    supabase.from("member").select("id, display_name").ilike("display_name", like).limit(LIMIT),
    supabase
      .from("song")
      .select("id, title, author")
      .or(`title.ilike.${like},author.ilike.${like}`)
      .limit(LIMIT),
    supabase.from("service").select("id, name").ilike("name", like).limit(LIMIT),
  ]);

  return {
    people: (people.data ?? []).map((m) => ({ id: m.id as string, name: m.display_name as string })),
    songs: (songs.data ?? []).map((s) => ({
      id: s.id as string,
      title: s.title as string,
      author: (s.author as string | null) ?? null,
    })),
    services: (services.data ?? []).map((s) => ({ id: s.id as string, name: s.name as string })),
  };
}
