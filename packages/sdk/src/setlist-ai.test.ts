import { describe, expect, it } from "vitest";
import { proposeSetlist, type SongMeta } from "./setlist-ai";

const NOW = new Date("2026-03-01T00:00:00Z");

function song(id: string, themes: string[], lastUsed: string | null): SongMeta {
  return { id, title: id, themes, last_used_at: lastUsed };
}

describe("proposeSetlist", () => {
  it("ranks on-theme, long-unused songs first", () => {
    const out = proposeSetlist({
      now: NOW,
      themes: ["grace"],
      count: 3,
      songs: [
        song("on-theme-stale", ["grace"], "2025-10-01"), // matches + very stale
        song("off-theme-fresh", ["joy"], "2026-02-28"), // no match + just used
        song("on-theme-recent", ["grace"], "2026-02-20"), // matches but recent
      ],
    });
    expect(out[0].song_id).toBe("on-theme-stale");
    expect(out[0].score).toBeGreaterThan(out[out.length - 1].score);
  });

  it("treats a never-used song as maximally fresh and says so", () => {
    const out = proposeSetlist({
      now: NOW,
      themes: [],
      count: 1,
      songs: [song("never", [], null)],
    });
    expect(out[0].reasons).toContain("new to the rotation");
  });

  it("respects the requested count and is deterministic", () => {
    const songs = [song("b", ["x"], null), song("a", ["x"], null), song("c", ["x"], null)];
    const out = proposeSetlist({ now: NOW, themes: ["x"], count: 2, songs });
    expect(out).toHaveLength(2);
    // Equal scores → stable title tiebreak.
    expect(out.map((s) => s.song_id)).toEqual(["a", "b"]);
  });

  it("explains a theme match", () => {
    const out = proposeSetlist({
      now: NOW,
      themes: ["Grace", "Hope"],
      count: 1,
      songs: [song("s", ["grace"], "2026-01-01")],
    });
    expect(out[0].reasons.some((r) => r.includes("matches theme: grace"))).toBe(true);
  });
});
