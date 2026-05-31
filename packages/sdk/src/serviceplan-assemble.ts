/**
 * Phase 7 (bridge) — EXPOSE the canonical exporter as a usable seam.
 *
 * `serviceplan.ts#toServicePlan` is the pure mapping; this module is the thin
 * layer that (a) assembles a {@link ServicePlan} from already-fetched parts
 * (pure, testable now) and (b) wires the Supabase fetch behind an injected port
 * so the data-fetch is swappable + the pure assembly is reused verbatim.
 *
 * Tiers:
 *   - `assembleServicePlan` — PURE. Given the fetched Service + items + setlist,
 *     resolve song references and delegate to `toServicePlan`. Fully tested.
 *   - `ServicePlanFetcher` + `fetchServicePlan` — the I/O seam. A `fetcher`
 *     (real impl talks to Supabase) returns the raw rows; this orchestrates the
 *     queries + assembly. The real fetcher is INFRA-UNVERIFIED (no live DB in
 *     this environment); the orchestration itself is tested against an in-memory
 *     fake fetcher. See docs/SMOKE-TEST.md.
 */

import type { Service, ServiceItem, Song, Setlist, SetlistSong } from "@sundayplan/shared";
import {
  toServicePlan,
  type ServicePlan,
  type ServiceItemWithSong,
  type SetlistEntryWithSong,
} from "./serviceplan";

// ── Tier 1: pure assembly from already-fetched rows ──────────────────────────────

/** The raw rows that make up one service, as the data layer returns them. */
export interface ServicePlanParts {
  service: Service;
  /** Ordered service items (any order in; sorted by position here). */
  items: ServiceItem[];
  /** The setlist songs for the service, when a separate setlist is used. */
  setlistSongs?: SetlistSong[];
  /**
   * Songs referenced by either `items[].song_id` or `setlistSongs[].song_id`,
   * keyed by song id. Missing entries degrade gracefully (a song item with no
   * resolved song carries a null `song_ref`; a setlist entry whose song is
   * missing is skipped rather than crashing).
   */
  songsById: Record<string, Song>;
}

/**
 * Assemble a {@link ServicePlan} from already-fetched parts. Pure + deterministic.
 *
 * - Items are sorted by `position` (the data layer needn't pre-sort).
 * - Each item's `song_id` is resolved against `songsById` so `toServicePlan`
 *   can build the song reference.
 * - Setlist entries are sorted by `position`, resolved, and any entry whose
 *   song is absent from `songsById` is dropped (rather than throwing).
 */
export function assembleServicePlan(parts: ServicePlanParts): ServicePlan {
  const items: ServiceItemWithSong[] = [...parts.items]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      item,
      song: item.song_id != null ? (parts.songsById[item.song_id] ?? null) : null,
    }));

  const setlist: SetlistEntryWithSong[] = [];
  for (const entry of [...(parts.setlistSongs ?? [])].sort((a, b) => a.position - b.position)) {
    const song = parts.songsById[entry.song_id];
    if (song != null) setlist.push({ entry, song });
  }

  return toServicePlan({ service: parts.service, items, setlist });
}

// ── Tier 2: the I/O seam (INFRA-UNVERIFIED real fetcher) ──────────────────────────

/**
 * Port the assembler reads through. A real implementation runs the Supabase
 * queries; the fake used in tests serves in-memory rows. Every method is
 * scoped by ids the caller already holds, so the implementation can enforce
 * tenancy (`church_id`) inside each query.
 */
export interface ServicePlanFetcher {
  getService(serviceId: string): Promise<Service | null>;
  getServiceItems(serviceId: string): Promise<ServiceItem[]>;
  /** The service's setlist, if one exists. */
  getSetlist(serviceId: string): Promise<Setlist | null>;
  getSetlistSongs(setlistId: string): Promise<SetlistSong[]>;
  /** Resolve the given song ids to song rows (order/extra entries don't matter). */
  getSongsByIds(churchId: string, songIds: string[]): Promise<Song[]>;
}

/** Discriminated result so callers handle "service not found" without a throw. */
export type FetchServicePlanResult =
  | { ok: true; plan: ServicePlan }
  | { ok: false; error: "service_not_found" };

/**
 * Fetch a service's rows through the {@link ServicePlanFetcher} and assemble the
 * canonical {@link ServicePlan}. The orchestration (which queries to run, how to
 * collect the song ids, gracefully skipping a missing setlist) is pure logic and
 * is unit-tested against an in-memory fake fetcher.
 *
 * The REAL fetcher (Supabase-backed) is INFRA-UNVERIFIED: there is no live
 * Postgres in this environment, so the wiring compiles + is exercised only via
 * the fake. Smoke-testing against a real database is a needs-Richard step
 * (docs/SMOKE-TEST.md, docs/NEEDS-RICHARD.md).
 */
export async function fetchServicePlan(
  fetcher: ServicePlanFetcher,
  serviceId: string,
): Promise<FetchServicePlanResult> {
  const service = await fetcher.getService(serviceId);
  if (service == null) return { ok: false, error: "service_not_found" };

  const items = await fetcher.getServiceItems(serviceId);

  const setlist = await fetcher.getSetlist(serviceId);
  const setlistSongs = setlist != null ? await fetcher.getSetlistSongs(setlist.id) : [];

  // Collect every distinct song id referenced by items or the setlist, then
  // resolve them in one batched call.
  const songIds = new Set<string>();
  for (const item of items) if (item.song_id != null) songIds.add(item.song_id);
  for (const entry of setlistSongs) songIds.add(entry.song_id);

  const songs =
    songIds.size > 0 ? await fetcher.getSongsByIds(service.church_id, [...songIds]) : [];
  const songsById: Record<string, Song> = {};
  for (const song of songs) songsById[song.id] = song;

  const plan = assembleServicePlan({ service, items, setlistSongs, songsById });
  return { ok: true, plan };
}
