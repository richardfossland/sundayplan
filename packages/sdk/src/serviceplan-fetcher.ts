/**
 * Phase 7 (bridge) — the concrete Supabase-backed {@link ServicePlanFetcher}.
 *
 * `serviceplan-assemble.ts` defines the I/O seam ({@link ServicePlanFetcher}) and
 * orchestrates it via `fetchServicePlan`; that orchestration is pure and already
 * tested against an in-memory fake. This module supplies the REAL fetcher: five
 * deterministic Supabase queries (service / service_item / setlist / setlist_song
 * / song) that the web route wires to a cookie-bound, RLS-enforcing client.
 *
 * The SDK deliberately does not depend on `@supabase/supabase-js`, so the
 * fetcher reads through a tiny STRUCTURAL seam ({@link ServicePlanQueryClient})
 * that the supabase-js query builder satisfies as-is. That keeps the SDK free of
 * the heavy client dep AND makes every query unit-testable against an in-memory
 * fake builder — no Docker, no network, no live Postgres.
 *
 * Tenancy: every row in the schema carries `church_id` and is fenced by RLS, so
 * the queries scope by the ids the caller already holds (service id → its items /
 * setlist; setlist id → its songs) and only `getSongsByIds` filters `church_id`
 * explicitly, matching the `Song` query in the songs data layer. The real client
 * is INFRA-UNVERIFIED here (no live DB in this environment); see docs/SMOKE-TEST.md.
 */

import type { Service, ServiceItem, Song, Setlist, SetlistSong } from "@sundayplan/shared";
import type { ServicePlanFetcher } from "./serviceplan-assemble";

// ── Structural Supabase seam (the supabase-js query builder satisfies this) ──────

/** Shape of a `{ data, error }` PostgREST response for a list query. */
export interface QueryResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/** Shape of a `{ data, error }` PostgREST response for a single-row query. */
export interface MaybeSingleResult<T> {
  data: T | null;
  error: { message: string } | null;
}

/**
 * The fluent subset of the supabase-js query builder this fetcher uses. Each
 * method narrows the rows by an equality / set filter; the terminal `order`
 * (list) or `maybeSingle` (one row) resolves the query. `await`-able because the
 * supabase builder is a thenable. Generic over the row type so the fake in tests
 * stays type-checked.
 */
export interface QueryBuilder<Row> extends PromiseLike<QueryResult<Row>> {
  eq(column: string, value: string): QueryBuilder<Row>;
  in(column: string, values: readonly string[]): QueryBuilder<Row>;
  order(column: string): QueryBuilder<Row>;
  maybeSingle(): PromiseLike<MaybeSingleResult<Row>>;
}

/** The `.from(table).select(cols)` entry point — the only client surface we need. */
export interface ServicePlanQueryClient {
  from(table: string): { select<Row = Record<string, unknown>>(columns: string): QueryBuilder<Row> };
}

// ── Concrete fetcher ─────────────────────────────────────────────────────────────

/** Throw on a PostgREST error so the route surfaces it (mirrors the data layer). */
function unwrap<T>(res: QueryResult<T>): T[] {
  if (res.error) throw new Error(res.error.message);
  return res.data ?? [];
}

function unwrapSingle<T>(res: MaybeSingleResult<T>): T | null {
  if (res.error) throw new Error(res.error.message);
  return res.data ?? null;
}

/**
 * Supabase-backed {@link ServicePlanFetcher}. Composes five deterministic queries
 * against the existing schema; tenancy is enforced by RLS on the injected client.
 *
 * INFRA-UNVERIFIED against a live database (no Postgres in this environment); the
 * queries are exercised by unit tests through an in-memory fake builder, and the
 * web route binds the real cookie-bound client.
 */
export class SupabaseServicePlanFetcher implements ServicePlanFetcher {
  constructor(private readonly client: ServicePlanQueryClient) {}

  async getService(serviceId: string): Promise<Service | null> {
    const res = await this.client
      .from("service")
      .select<Service>(
        "id, church_id, template_id, name, starts_at_utc, notes, state, was_streamed_flag",
      )
      .eq("id", serviceId)
      .maybeSingle();
    return unwrapSingle(res);
  }

  async getServiceItems(serviceId: string): Promise<ServiceItem[]> {
    const res = await this.client
      .from("service_item")
      .select<ServiceItem>(
        "id, service_id, position, label, kind, duration_min, notes, song_id, scripture_ref",
      )
      .eq("service_id", serviceId)
      .order("position");
    return unwrap(res);
  }

  async getSetlist(serviceId: string): Promise<Setlist | null> {
    const res = await this.client
      .from("setlist")
      .select<Setlist>("id, service_id")
      .eq("service_id", serviceId)
      .maybeSingle();
    return unwrapSingle(res);
  }

  async getSetlistSongs(setlistId: string): Promise<SetlistSong[]> {
    const res = await this.client
      .from("setlist_song")
      .select<SetlistSong>("setlist_id, position, song_id, key_override, notes")
      .eq("setlist_id", setlistId)
      .order("position");
    return unwrap(res);
  }

  async getSongsByIds(churchId: string, songIds: string[]): Promise<Song[]> {
    if (songIds.length === 0) return [];
    const res = await this.client
      .from("song")
      .select<Song>(
        "id, church_id, title, author, ccli_song_id, tono_work_id, default_key, tempo_bpm, language, themes, last_used_at, sundaysong_id, chord_chart_url, demo_url",
      )
      .eq("church_id", churchId)
      .in("id", songIds);
    return unwrap(res);
  }
}
