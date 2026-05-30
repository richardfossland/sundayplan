import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";
import type { SongUsageRow } from "@sundayplan/shared";

/**
 * Phase 11 data layer — gather licensing usage rows for the active church.
 *
 * RLS-scoped via the cookie-bound server client. Pulls every `played` service
 * in the date range, then the songs used in each — from BOTH the order of
 * service (`service_item.song_id`) and the musical setlist (`setlist_song` via
 * its parent `setlist.service_id`) — joins song TONO/CCLI ids + the service
 * `was_streamed_flag`, and normalizes into the pure {@link SongUsageRow}s the
 * SDK report engine consumes.
 *
 * Mapping concerns only live here; all grouping/splitting/CSV is in the SDK.
 * Real columns: `song.tono_work_id`, `song.ccli_song_id`,
 * `service.was_streamed_flag`, `service.state='played'`, `service.starts_at_utc`
 * (there is no separate local column in the schema — we report on UTC start).
 */

interface SongMeta {
  id: string;
  title: string;
  tono_work_id: string | null;
  ccli_song_id: string | null;
}

interface ServiceMeta {
  id: string;
  starts_at_utc: string;
  was_streamed_flag: boolean;
}

/**
 * Fetch normalized song-usage rows for played services in `[from, to)`.
 * `from`/`to` are ISO date(-time) strings.
 */
export async function getSongUsageRows(
  from: string,
  to: string,
): Promise<SongUsageRow[]> {
  const churchId = await getCurrentChurchId();
  if (!churchId) return [];
  const supabase = await createClient();

  // 1. Played services in range (from inclusive / to exclusive).
  const { data: services, error: svcErr } = await supabase
    .from("service")
    .select("id, starts_at_utc, was_streamed_flag")
    .eq("church_id", churchId)
    .eq("state", "played")
    .gte("starts_at_utc", from)
    .lt("starts_at_utc", to)
    .order("starts_at_utc");
  if (svcErr) throw svcErr;

  const serviceList = (services ?? []) as ServiceMeta[];
  if (serviceList.length === 0) return [];
  const serviceById = new Map(serviceList.map((s) => [s.id, s]));
  const serviceIds = serviceList.map((s) => s.id);

  // 2. Song usages from the order of service (service_item has no church_id;
  //    it is scoped through its parent service, already filtered above).
  const { data: items, error: itemErr } = await supabase
    .from("service_item")
    .select("service_id, song_id")
    .in("service_id", serviceIds)
    .not("song_id", "is", null);
  if (itemErr) throw itemErr;

  // 3. Song usages from the musical setlist. setlist_song has no service_id of
  //    its own — it joins through setlist (one row per service).
  const { data: setlists, error: slErr } = await supabase
    .from("setlist")
    .select("service_id, setlist_song(song_id)")
    .in("service_id", serviceIds);
  if (slErr) throw slErr;

  type SetlistRow = { service_id: string; setlist_song: { song_id: string }[] | null };
  const setlistUsages: { service_id: string; song_id: string }[] = [];
  for (const sl of (setlists ?? []) as SetlistRow[]) {
    for (const s of sl.setlist_song ?? []) {
      if (s.song_id) setlistUsages.push({ service_id: sl.service_id, song_id: s.song_id });
    }
  }

  // 4. Resolve song metadata for all referenced songs.
  const songIds = new Set<string>();
  for (const r of items ?? []) if (r.song_id) songIds.add(r.song_id as string);
  for (const r of setlistUsages) songIds.add(r.song_id);
  if (songIds.size === 0) return [];

  const { data: songs, error: songErr } = await supabase
    .from("song")
    .select("id, title, tono_work_id, ccli_song_id")
    .eq("church_id", churchId)
    .in("id", [...songIds]);
  if (songErr) throw songErr;
  const songById = new Map((songs ?? []).map((s) => [s.id, s as SongMeta]));

  // 5. Normalize. A song may appear in BOTH the order of service and the
  //    setlist for the same service — count it once per (service, song).
  const seen = new Set<string>();
  const rows: SongUsageRow[] = [];
  const pushUsage = (serviceId: string, songId: string | null) => {
    if (!songId) return;
    const key = `${serviceId}:${songId}`;
    if (seen.has(key)) return;
    const song = songById.get(songId);
    const svc = serviceById.get(serviceId);
    if (!song || !svc) return;
    seen.add(key);
    rows.push({
      songId: song.id,
      title: song.title,
      tonoWorkId: song.tono_work_id,
      ccliNumber: song.ccli_song_id,
      serviceId: svc.id,
      serviceDateLocal: svc.starts_at_utc,
      wasStreamed: svc.was_streamed_flag,
    });
  };

  for (const r of items ?? []) pushUsage(r.service_id as string, r.song_id as string | null);
  for (const r of setlistUsages) pushUsage(r.service_id, r.song_id);

  return rows;
}
