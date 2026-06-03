import { describe, expect, it } from "vitest";
import type { Service, ServiceItem, Song, Setlist, SetlistSong } from "@sundayplan/shared";
import { fetchServicePlan } from "./serviceplan-assemble";
import {
  SupabaseServicePlanFetcher,
  type ServicePlanQueryClient,
  type QueryBuilder,
  type QueryResult,
  type MaybeSingleResult,
} from "./serviceplan-fetcher";

// ── In-memory fake of the structural Supabase seam ───────────────────────────────
//
// Stands in for the (INFRA-UNVERIFIED) supabase-js builder: records the chained
// filters, then serves rows from an in-memory table applying eq/in. This lets us
// assert the EXACT query each fetcher method runs (table, filters, ordering)
// without Docker / network / a live Postgres.

interface FilterCall {
  table: string;
  columns: string;
  eq: Array<[string, string]>;
  in: Array<[string, readonly string[]]>;
  ordered: string | null;
  single: boolean;
}

type Tables = Record<string, Record<string, unknown>[]>;

function fakeClient(tables: Tables, recorder: FilterCall[] = []) {
  function applyFilters(call: FilterCall): Record<string, unknown>[] {
    let rows = tables[call.table] ?? [];
    for (const [col, val] of call.eq) rows = rows.filter((r) => r[col] === val);
    for (const [col, vals] of call.in) rows = rows.filter((r) => vals.includes(r[col] as string));
    if (call.ordered) {
      rows = [...rows].sort(
        (a, b) => (a[call.ordered!] as number) - (b[call.ordered!] as number),
      );
    }
    return rows;
  }

  function builder<Row>(call: FilterCall): QueryBuilder<Row> {
    const self: QueryBuilder<Row> = {
      eq(column, value) {
        call.eq.push([column, value]);
        return self;
      },
      in(column, values) {
        call.in.push([column, values]);
        return self;
      },
      order(column) {
        call.ordered = column;
        return self;
      },
      maybeSingle() {
        call.single = true;
        const rows = applyFilters(call);
        const result: MaybeSingleResult<Row> = {
          data: (rows[0] ?? null) as Row | null,
          error: null,
        };
        return Promise.resolve(result);
      },
      then(onfulfilled) {
        const result: QueryResult<Row> = {
          data: applyFilters(call) as Row[],
          error: null,
        };
        return Promise.resolve(result).then(onfulfilled);
      },
    };
    return self;
  }

  const client: ServicePlanQueryClient = {
    from(table) {
      return {
        select<Row = Record<string, unknown>>(columns: string) {
          const call: FilterCall = {
            table,
            columns,
            eq: [],
            in: [],
            ordered: null,
            single: false,
          };
          recorder.push(call);
          return builder<Row>(call);
        },
      };
    },
  };
  return { client, recorder };
}

/** A client whose first `select` on `table` returns a PostgREST error. */
function erroringClient(table: string, message: string): ServicePlanQueryClient {
  return {
    from(t) {
      return {
        select<Row = Record<string, unknown>>(_columns: string) {
          const fail = t === table;
          const self: QueryBuilder<Row> = {
            eq: () => self,
            in: () => self,
            order: () => self,
            maybeSingle: () =>
              Promise.resolve({ data: null, error: fail ? { message } : null }),
            then: (onfulfilled) =>
              Promise.resolve({
                data: (fail ? null : []) as Row[] | null,
                error: fail ? { message } : null,
              }).then(onfulfilled),
          };
          return self;
        },
      };
    },
  };
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const service: Service = {
  id: "svc1",
  church_id: "ch1",
  template_id: null,
  name: "Sunday Morning",
  starts_at_utc: "2026-09-13T09:00:00Z",
  notes: null,
  state: "published",
  was_streamed_flag: false,
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

function item(
  partial: Partial<ServiceItem> & Pick<ServiceItem, "id" | "position">,
): ServiceItem {
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

const opener = song({ id: "song1", title: "10,000 Reasons", sundaysong_id: "ss-999" });
const closer = song({ id: "song2", title: "Build My Life", church_id: "ch1" });
// A song belonging to ANOTHER church — RLS / the church_id filter must exclude it.
const foreign = song({ id: "song3", title: "Foreign", church_id: "ch2" });

const setlist: Setlist = { id: "sl1", service_id: "svc1" };
const setlistSongs: SetlistSong[] = [
  { setlist_id: "sl1", position: 2, song_id: "song2", key_override: "C", notes: null },
  { setlist_id: "sl1", position: 1, song_id: "song1", key_override: "A", notes: null },
];
const items: ServiceItem[] = [
  item({ id: "i2", position: 2, kind: "sermon", label: "Sermon" }),
  item({ id: "i1", position: 1, kind: "song", label: "Opener", song_id: "song1" }),
];

function fullTables(): Tables {
  return {
    service: [service as unknown as Record<string, unknown>],
    service_item: items as unknown as Record<string, unknown>[],
    setlist: [setlist as unknown as Record<string, unknown>],
    setlist_song: setlistSongs as unknown as Record<string, unknown>[],
    song: [opener, closer, foreign] as unknown as Record<string, unknown>[],
  };
}

// ── Per-method query shape ───────────────────────────────────────────────────────

describe("SupabaseServicePlanFetcher — query shapes", () => {
  it("getService scopes by id and reads a single row", async () => {
    const { client, recorder } = fakeClient(fullTables());
    const found = await new SupabaseServicePlanFetcher(client).getService("svc1");
    expect(found?.id).toBe("svc1");
    expect(recorder[0]).toMatchObject({ table: "service", eq: [["id", "svc1"]], single: true });
    expect(recorder[0].columns).toContain("church_id");
  });

  it("getService returns null for an id the client can't see (RLS / missing)", async () => {
    const { client } = fakeClient(fullTables());
    expect(await new SupabaseServicePlanFetcher(client).getService("nope")).toBeNull();
  });

  it("getServiceItems filters by service_id and orders by position", async () => {
    const { client, recorder } = fakeClient(fullTables());
    const rows = await new SupabaseServicePlanFetcher(client).getServiceItems("svc1");
    expect(rows.map((r) => r.position)).toEqual([1, 2]); // ordered
    expect(recorder[0]).toMatchObject({
      table: "service_item",
      eq: [["service_id", "svc1"]],
      ordered: "position",
    });
  });

  it("getSetlist returns the service's setlist or null", async () => {
    const { client } = fakeClient(fullTables());
    const f = new SupabaseServicePlanFetcher(client);
    expect((await f.getSetlist("svc1"))?.id).toBe("sl1");
    expect(await f.getSetlist("svc-other")).toBeNull();
  });

  it("getSetlistSongs filters by setlist_id and orders by position", async () => {
    const { client, recorder } = fakeClient(fullTables());
    const rows = await new SupabaseServicePlanFetcher(client).getSetlistSongs("sl1");
    expect(rows.map((r) => r.position)).toEqual([1, 2]);
    expect(recorder[0]).toMatchObject({
      table: "setlist_song",
      eq: [["setlist_id", "sl1"]],
      ordered: "position",
    });
  });

  it("getSongsByIds filters by church_id + id IN (...), excluding other churches' songs", async () => {
    const { client, recorder } = fakeClient(fullTables());
    const rows = await new SupabaseServicePlanFetcher(client).getSongsByIds("ch1", [
      "song1",
      "song2",
      "song3",
    ]);
    // song3 belongs to ch2 → excluded by the church_id filter.
    expect(rows.map((r) => r.id).sort()).toEqual(["song1", "song2"]);
    expect(recorder[0]).toMatchObject({
      table: "song",
      eq: [["church_id", "ch1"]],
      in: [["id", ["song1", "song2", "song3"]]],
    });
  });

  it("getSongsByIds short-circuits to [] without a query when given no ids", async () => {
    const { client, recorder } = fakeClient(fullTables());
    expect(await new SupabaseServicePlanFetcher(client).getSongsByIds("ch1", [])).toEqual([]);
    expect(recorder).toHaveLength(0);
  });
});

// ── PostgREST errors propagate (mirrors the data layer's throw-on-error) ──────────

describe("SupabaseServicePlanFetcher — error propagation", () => {
  it("throws when getService's query returns an error", async () => {
    const f = new SupabaseServicePlanFetcher(erroringClient("service", "boom"));
    await expect(f.getService("svc1")).rejects.toThrow("boom");
  });

  it("throws when getServiceItems' query returns an error", async () => {
    const f = new SupabaseServicePlanFetcher(erroringClient("service_item", "down"));
    await expect(f.getServiceItems("svc1")).rejects.toThrow("down");
  });
});

// ── End-to-end through the (already-tested) fetchServicePlan orchestration ────────

describe("SupabaseServicePlanFetcher × fetchServicePlan", () => {
  it("assembles the canonical plan: items resolved + setlist appended", async () => {
    const { client } = fakeClient(fullTables());
    const res = await fetchServicePlan(new SupabaseServicePlanFetcher(client), "svc1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.service.id).toBe("svc1");
    // i1 is a song item resolved to opener.
    expect(res.plan.items.find((i) => i.position === 1)?.song_ref?.sundaysong_id).toBe("ss-999");
    // 2 service items + 2 setlist songs appended, positions continuing.
    expect(res.plan.items.map((i) => i.position)).toEqual([1, 2, 3, 4]);
    expect(res.plan.items.slice(2).map((i) => [i.title, i.key_override])).toEqual([
      ["10,000 Reasons", "A"],
      ["Build My Life", "C"],
    ]);
  });

  it("returns service_not_found when the service is absent / not visible", async () => {
    const { client } = fakeClient(fullTables());
    const res = await fetchServicePlan(new SupabaseServicePlanFetcher(client), "ghost");
    expect(res).toEqual({ ok: false, error: "service_not_found" });
  });

  it("handles a service with no setlist (no setlist_song query needed)", async () => {
    const tables = fullTables();
    tables.setlist = [];
    tables.setlist_song = [];
    const { client, recorder } = fakeClient(tables);
    const res = await fetchServicePlan(new SupabaseServicePlanFetcher(client), "svc1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.items.map((i) => i.position)).toEqual([1, 2]); // only service items
    // setlist_song was never queried.
    expect(recorder.some((c) => c.table === "setlist_song")).toBe(false);
  });

  it("drops a setlist entry whose song is unresolved (e.g. filtered out by RLS)", async () => {
    const tables = fullTables();
    // Reference a song id that getSongsByIds won't return (foreign church).
    tables.setlist_song = [
      { setlist_id: "sl1", position: 1, song_id: "song1", key_override: null, notes: null },
      { setlist_id: "sl1", position: 2, song_id: "song3", key_override: null, notes: null },
    ];
    const { client } = fakeClient(tables);
    const res = await fetchServicePlan(new SupabaseServicePlanFetcher(client), "svc1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const setlistTitles = res.plan.items.slice(2).map((i) => i.title);
    expect(setlistTitles).toEqual(["10,000 Reasons"]); // song3 (ch2) dropped
  });
});
