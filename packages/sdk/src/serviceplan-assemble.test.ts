import { describe, expect, it } from "vitest";
import type {
  Service,
  ServiceItem,
  Song,
  Setlist,
  SetlistSong,
} from "@sundayplan/shared";
import {
  assembleServicePlan,
  fetchServicePlan,
  type ServicePlanFetcher,
  type ServicePlanParts,
} from "./serviceplan-assemble";
import {
  writeServicePlanBundle,
  readServicePlanBundle,
  serializeServicePlanBundle,
  SERVICEPLAN_BUNDLE_VERSION,
  BUNDLE_PRODUCER,
} from "./serviceplan-bundle";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const service: Service = {
  id: "svc1",
  church_id: "ch1",
  template_id: null,
  name: "Sunday Morning",
  starts_at_utc: "2026-09-13T09:00:00Z",
  notes: "Communion Sunday",
  state: "published",
  was_streamed_flag: true,
};

function song(partial: Partial<Song> & Pick<Song, "id" | "title">): Song {
  return {
    church_id: "ch1",
    author: null,
    ccli_song_id: null,
    tono_work_id: null,
    default_key: null,
    tempo_bpm: null,
    language: "en",
    themes: [],
    last_used_at: null,
    sundaysong_id: null,
    chord_chart_url: null,
    demo_url: null,
    ...partial,
  };
}

function item(partial: Partial<ServiceItem> & Pick<ServiceItem, "id" | "position">): ServiceItem {
  return {
    service_id: "svc1",
    label: "Item",
    kind: "gap",
    duration_min: 5,
    notes: null,
    song_id: null,
    scripture_ref: null,
    ...partial,
  };
}

const opener = song({ id: "song1", title: "10,000 Reasons", sundaysong_id: "ss-999", ccli_song_id: "6016351" });
const response = song({ id: "song2", title: "Build My Life", sundaysong_id: "ss-101" });

// ── Tier 1: pure assembly ───────────────────────────────────────────────────────

describe("assembleServicePlan", () => {
  it("sorts items by position and resolves song refs", () => {
    const parts: ServicePlanParts = {
      service,
      items: [
        item({ id: "i3", position: 3, kind: "sermon", label: "Sermon" }),
        item({ id: "i1", position: 1, kind: "welcome", label: "Welcome" }),
        item({ id: "i2", position: 2, kind: "song", label: "Opener", song_id: "song1", duration_min: 4 }),
      ],
      songsById: { song1: opener },
    };
    const plan = assembleServicePlan(parts);
    expect(plan.items.map((i) => [i.position, i.kind])).toEqual([
      [1, "welcome"],
      [2, "song"],
      [3, "sermon"],
    ]);
    expect(plan.items[1].song_ref?.sundaysong_id).toBe("ss-999");
  });

  it("leaves song_ref null when a song item's song is missing from the map", () => {
    const plan = assembleServicePlan({
      service,
      items: [item({ id: "i1", position: 1, kind: "song", song_id: "missing" })],
      songsById: {},
    });
    expect(plan.items[0].kind).toBe("song");
    expect(plan.items[0].song_ref).toBeNull();
  });

  it("appends + sorts the setlist, dropping entries whose song is unresolved", () => {
    const setlistSongs: SetlistSong[] = [
      { setlist_id: "sl1", position: 2, song_id: "song2", key_override: "C", notes: null },
      { setlist_id: "sl1", position: 1, song_id: "song1", key_override: "A", notes: null },
      { setlist_id: "sl1", position: 3, song_id: "ghost", key_override: null, notes: null },
    ];
    const plan = assembleServicePlan({
      service,
      items: [item({ id: "i1", position: 1, kind: "welcome", label: "Welcome" })],
      setlistSongs,
      songsById: { song1: opener, song2: response },
    });
    // 1 welcome item + 2 resolvable setlist songs (ghost dropped).
    expect(plan.items).toHaveLength(3);
    expect(plan.items.slice(1).map((i) => [i.title, i.key_override])).toEqual([
      ["10,000 Reasons", "A"],
      ["Build My Life", "C"],
    ]);
    // positions continue after the welcome item.
    expect(plan.items.map((i) => i.position)).toEqual([1, 2, 3]);
  });
});

// ── Tier 1: bundle round-trip (the contract test the task asks for) ───────────────

describe("ServicePlan bundle round-trip", () => {
  it("sample Service+items+setlist → ServicePlan → bundle → serialize → read back", () => {
    const setlistSongs: SetlistSong[] = [
      { setlist_id: "sl1", position: 1, song_id: "song1", key_override: "A", notes: "capo 2" },
      { setlist_id: "sl1", position: 2, song_id: "song2", key_override: null, notes: null },
    ];
    const plan = assembleServicePlan({
      service,
      items: [
        item({ id: "i1", position: 1, kind: "welcome", label: "Welcome" }),
        item({ id: "i2", position: 2, kind: "scripture", label: "Reading", scripture_ref: "John 3:16" }),
        item({ id: "i3", position: 3, kind: "sermon", label: "Sermon", duration_min: 30 }),
      ],
      setlistSongs,
      songsById: { song1: opener, song2: response },
    });

    // Write the bundle with an injected deterministic clock.
    const bundle = writeServicePlanBundle(plan, { now: () => "2026-09-12T20:00:00Z" });
    expect(bundle.version).toBe(SERVICEPLAN_BUNDLE_VERSION);
    expect(bundle.producer).toBe(BUNDLE_PRODUCER);
    expect(bundle.generated_at).toBe("2026-09-12T20:00:00Z");
    expect(bundle.service_id).toBe("svc1");

    // Round-trip through JSON (mirrors writing to disk / a transport).
    const json = serializeServicePlanBundle(bundle);
    const parsed: unknown = JSON.parse(json);
    const read = readServicePlanBundle(parsed);

    expect(read.ok).toBe(true);
    if (!read.ok) return; // narrow for TS
    // The recovered plan is structurally identical to the one we wrote.
    expect(read.bundle.plan).toEqual(plan);
    expect(read.bundle.service_id).toBe(read.bundle.plan.service.id);
  });

  it("leaves generated_at null when no clock is injected", () => {
    const plan = assembleServicePlan({ service, items: [], songsById: {} });
    expect(writeServicePlanBundle(plan).generated_at).toBeNull();
  });
});

describe("readServicePlanBundle — validation", () => {
  const plan = assembleServicePlan({ service, items: [], songsById: {} });
  const good = writeServicePlanBundle(plan);

  it("rejects non-objects + missing fields", () => {
    expect(readServicePlanBundle(null).ok).toBe(false);
    expect(readServicePlanBundle("nope").ok).toBe(false);
    expect(readServicePlanBundle({ version: 1 }).ok).toBe(false);
  });

  it("rejects a bundle from a newer schema version", () => {
    const r = readServicePlanBundle({ ...good, version: SERVICEPLAN_BUNDLE_VERSION + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("unsupported bundle version");
  });

  it("rejects a service_id that disagrees with plan.service.id", () => {
    const r = readServicePlanBundle({ ...good, service_id: "other" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("mismatch");
  });

  it("accepts a well-formed bundle", () => {
    expect(readServicePlanBundle(good).ok).toBe(true);
  });
});

// ── Tier 2: fetch orchestration against an in-memory fake fetcher ────────────────

/** In-memory fake — stands in for the (INFRA-UNVERIFIED) Supabase-backed fetcher. */
function fakeFetcher(over: Partial<ServicePlanFetcher> = {}): ServicePlanFetcher {
  const setlist: Setlist = { id: "sl1", service_id: "svc1" };
  const setlistSongs: SetlistSong[] = [
    { setlist_id: "sl1", position: 1, song_id: "song1", key_override: "A", notes: null },
  ];
  const items: ServiceItem[] = [
    item({ id: "i1", position: 1, kind: "song", label: "Opener", song_id: "song1" }),
    item({ id: "i2", position: 2, kind: "sermon", label: "Sermon" }),
  ];
  return {
    getService: async (id) => (id === "svc1" ? service : null),
    getServiceItems: async () => items,
    getSetlist: async () => setlist,
    getSetlistSongs: async () => setlistSongs,
    getSongsByIds: async (_ch, ids) => [opener, response].filter((s) => ids.includes(s.id)),
    ...over,
  };
}

describe("fetchServicePlan", () => {
  it("orchestrates the queries and assembles the canonical plan", async () => {
    const res = await fetchServicePlan(fakeFetcher(), "svc1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.service.id).toBe("svc1");
    // item song resolved + setlist song appended.
    expect(res.plan.items.find((i) => i.position === 1)?.song_ref?.sundaysong_id).toBe("ss-999");
    expect(res.plan.items.at(-1)?.key_override).toBe("A");
  });

  it("returns service_not_found instead of throwing when the service is absent", async () => {
    const res = await fetchServicePlan(fakeFetcher(), "ghost");
    expect(res).toEqual({ ok: false, error: "service_not_found" });
  });

  it("batches every referenced song id in a single getSongsByIds call", async () => {
    const calls: string[][] = [];
    const res = await fetchServicePlan(
      fakeFetcher({
        getSongsByIds: async (_ch, ids) => {
          calls.push([...ids].sort());
          return [opener];
        },
      }),
      "svc1",
    );
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    // song1 (item + setlist) collected once, deduped.
    expect(calls[0]).toEqual(["song1"]);
  });

  it("skips the setlist queries entirely when there is no setlist", async () => {
    let setlistSongsCalled = false;
    const res = await fetchServicePlan(
      fakeFetcher({
        getSetlist: async () => null,
        getSetlistSongs: async () => {
          setlistSongsCalled = true;
          return [];
        },
      }),
      "svc1",
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(setlistSongsCalled).toBe(false);
    // only the two service items, no appended setlist song.
    expect(res.plan.items).toHaveLength(2);
  });
});
