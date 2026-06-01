/**
 * Setlist assist (Asaph-style) — proposes worship songs for a service by theme
 * fit + rotation freshness. Pure and deterministic, so it works offline with no
 * model or API key (the SundaySong sibling / an LLM is an optional rerank seam
 * layered on top later, mirroring channels.ts's provider-seam discipline).
 *
 * Heuristic, 0–100:
 *   • theme match  — overlap between the song's themes and the service's focus
 *   • freshness    — how long since the song was last used (rotation fairness)
 * Never-used songs count as maximally fresh; a song with no theme data leans on
 * freshness alone. The blend favours on-theme songs the church hasn't sung lately.
 */
const DAY_MS = 86_400_000;
const FRESH_CAP_DAYS = 90; // fully "fresh" once it's been this long (or never used)
const THEME_WEIGHT = 0.6;
const FRESHNESS_WEIGHT = 0.4;

export interface SongMeta {
  id: string;
  title: string;
  themes: string[];
  /** ISO timestamp of last use, or null if never used. */
  last_used_at: string | null;
}

export interface SetlistRequest {
  songs: SongMeta[];
  /** The service's thematic focus (theme tags / scripture themes). */
  themes: string[];
  /** How many songs to propose. */
  count: number;
  now?: Date;
}

export interface SetlistSuggestion {
  song_id: string;
  title: string;
  score: number;
  reasons: string[];
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function proposeSetlist(req: SetlistRequest): SetlistSuggestion[] {
  const now = req.now ?? new Date();
  const wanted = new Set(req.themes.map(norm));

  const scored: SetlistSuggestion[] = req.songs.map((song) => {
    const reasons: string[] = [];

    // Theme match: share of the requested themes this song covers.
    const matched = song.themes.map(norm).filter((t) => wanted.has(t));
    const themeMatch = wanted.size === 0 ? 0 : matched.length / wanted.size;
    if (matched.length > 0) reasons.push(`matches theme: ${matched.join(", ")}`);

    // Freshness: longer since last use → higher; never used → max.
    let freshness: number;
    if (!song.last_used_at) {
      freshness = 1;
      reasons.push("new to the rotation");
    } else {
      const days = Math.max(0, Math.floor((now.getTime() - new Date(song.last_used_at).getTime()) / DAY_MS));
      freshness = Math.min(days / FRESH_CAP_DAYS, 1);
      reasons.push(days >= FRESH_CAP_DAYS ? `not sung in ${days} days` : `last sung ${days} days ago`);
    }

    const score = Math.round((THEME_WEIGHT * themeMatch + FRESHNESS_WEIGHT * freshness) * 100);
    return { song_id: song.id, title: song.title, score, reasons };
  });

  // Highest score first; stable tiebreak on title so output is deterministic.
  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return scored.slice(0, Math.max(0, req.count));
}
