import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";
import type { SongUsageRow } from "@sundayplan/shared";
import type {
  ServeRow,
  CoverageRow,
  ChurnMember,
  ChurnAssignment,
  RoleRef,
  RoleQualification,
  RoleTarget,
} from "@sundayplan/sdk";

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

// ── Volunteer balance ───────────────────────────────────────────────────────

const ACTIVE_STATUSES = ["pending", "invited", "accepted", "no_response"];

interface ServeEmbed {
  member_id: string;
  status: string;
  service: { starts_at_utc: string; state: string } | null;
  member: { display_name: string; target_serves_per_month: number | null } | null;
}

/**
 * Committed serves in `[from, to)` — one row per active (not declined/removed)
 * assignment on a non-archived service. RLS-scoped via the cookie-bound client.
 */
export async function getServeRows(from: string, to: string): Promise<ServeRow[]> {
  const churchId = await getCurrentChurchId();
  if (!churchId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assignment")
    .select(
      "member_id, service_id, status, service:service_id(starts_at_utc, state), member:member_id(display_name, target_serves_per_month)",
    )
    .eq("church_id", churchId)
    .in("status", ACTIVE_STATUSES);
  if (error) throw error;

  const rows: ServeRow[] = [];
  for (const a of (data ?? []) as unknown as (ServeEmbed & { service_id: string })[]) {
    const svc = a.service;
    if (!svc || svc.state === "archived") continue;
    if (svc.starts_at_utc < from || svc.starts_at_utc >= to) continue;
    rows.push({
      memberId: a.member_id,
      name: a.member?.display_name ?? a.member_id,
      targetPerMonth: a.member?.target_serves_per_month ?? null,
      serviceId: a.service_id,
      serviceDateLocal: svc.starts_at_utc,
    });
  }
  return rows;
}

// ── Service coverage ──────────────────────────────────────────────────────────

interface CoverageServiceRow {
  id: string;
  name: string;
  starts_at_utc: string;
  template_id: string | null;
}
interface RequirementEmbed {
  template_id: string;
  quantity: number;
  role: { id: string; name: string } | null;
}

/**
 * Per-role coverage rows for templated services in `[from, to)`: required
 * (from the template's role requirements) vs filled (active assignments).
 */
export async function getCoverageRows(from: string, to: string): Promise<CoverageRow[]> {
  const churchId = await getCurrentChurchId();
  if (!churchId) return [];
  const supabase = await createClient();

  const { data: services, error: svcErr } = await supabase
    .from("service")
    .select("id, name, starts_at_utc, template_id")
    .eq("church_id", churchId)
    .neq("state", "archived")
    .gte("starts_at_utc", from)
    .lt("starts_at_utc", to)
    .order("starts_at_utc");
  if (svcErr) throw svcErr;

  const svcRows = ((services ?? []) as CoverageServiceRow[]).filter((s) => s.template_id);
  if (svcRows.length === 0) return [];
  const templateIds = [...new Set(svcRows.map((s) => s.template_id as string))];
  const serviceIds = svcRows.map((s) => s.id);

  const [{ data: reqs, error: reqErr }, { data: assigns, error: asgErr }] = await Promise.all([
    supabase
      .from("service_team_requirement")
      .select("template_id, quantity, role:role_id(id, name)")
      .in("template_id", templateIds),
    supabase
      .from("assignment")
      .select("service_id, role_id, status")
      .in("service_id", serviceIds)
      .in("status", ACTIVE_STATUSES),
  ]);
  if (reqErr) throw reqErr;
  if (asgErr) throw asgErr;

  // filled count per (service, role)
  const filled = new Map<string, number>();
  for (const a of (assigns ?? []) as { service_id: string; role_id: string }[]) {
    const key = `${a.service_id}|${a.role_id}`;
    filled.set(key, (filled.get(key) ?? 0) + 1);
  }

  const reqByTemplate = new Map<string, RequirementEmbed[]>();
  for (const r of (reqs ?? []) as unknown as RequirementEmbed[]) {
    const list = reqByTemplate.get(r.template_id) ?? [];
    list.push(r);
    reqByTemplate.set(r.template_id, list);
  }

  const rows: CoverageRow[] = [];
  for (const s of svcRows) {
    for (const req of reqByTemplate.get(s.template_id as string) ?? []) {
      if (!req.role) continue;
      rows.push({
        serviceId: s.id,
        serviceName: s.name,
        serviceDateLocal: s.starts_at_utc,
        roleId: req.role.id,
        roleName: req.role.name,
        required: req.quantity,
        filled: filled.get(`${s.id}|${req.role.id}`) ?? 0,
      });
    }
  }
  return rows;
}

// ── Volunteer health (churn / retention) ──────────────────────────────────────

interface ChurnMemberRow {
  id: string;
  display_name: string;
  joined_at: string | null;
  status: string;
}
interface ChurnAssignmentEmbed {
  member_id: string;
  service: { starts_at_utc: string; state: string } | null;
}

/**
 * Every member of the active church plus their committed serves — the raw input
 * for {@link buildChurnReport}. Unlike the licensing/coverage reports this is
 * NOT date-windowed: churn looks across a member's whole history relative to
 * `now` (which the SDK engine receives, not this layer). RLS-scoped.
 *
 * Returns `null` member status falls back to 'inactive' so it is never counted
 * as retained; archived services are dropped from the serve history.
 */
export async function getChurnInputs(): Promise<{
  members: ChurnMember[];
  assignments: ChurnAssignment[];
}> {
  const churchId = await getCurrentChurchId();
  if (!churchId) return { members: [], assignments: [] };
  const supabase = await createClient();

  const [{ data: memberData, error: memberErr }, { data: asgData, error: asgErr }] =
    await Promise.all([
      supabase
        .from("member")
        .select("id, display_name, joined_at, status")
        .eq("church_id", churchId),
      supabase
        .from("assignment")
        .select("member_id, service:service_id(starts_at_utc, state)")
        .eq("church_id", churchId)
        .in("status", ACTIVE_STATUSES),
    ]);
  if (memberErr) throw memberErr;
  if (asgErr) throw asgErr;

  const members: ChurnMember[] = ((memberData ?? []) as ChurnMemberRow[]).map((m) => ({
    memberId: m.id,
    name: m.display_name,
    joinedAtLocal: m.joined_at,
    // member.status is one of active|inactive|archived (DB CHECK); narrow safely.
    status: m.status === "active" ? "active" : m.status === "archived" ? "archived" : "inactive",
  }));

  const assignments: ChurnAssignment[] = [];
  for (const a of (asgData ?? []) as unknown as ChurnAssignmentEmbed[]) {
    const svc = a.service;
    if (!svc || svc.state === "archived") continue;
    assignments.push({ memberId: a.member_id, serviceDateLocal: svc.starts_at_utc });
  }
  return { members, assignments };
}

// ── Role balance (recruiting heatmap) ─────────────────────────────────────────

interface RoleRowDb {
  id: string;
  name: string;
  recruit_target: number | null;
  team: { name: string } | null;
}
interface QualEmbed {
  role_id: string;
  member: { status: string } | null;
}

/**
 * Per-role recruiting inputs for {@link buildRoleBalanceReport}: the church's
 * roles (with their optional `recruit_target` + team name), and every
 * member→role qualification from `team_membership` tagged with whether the
 * member is currently active. RLS-scoped via the cookie-bound client.
 *
 * `role` carries no `church_id`; it is scoped through its `team` (which does),
 * so we filter teams by church and read roles per team. Qualifications likewise
 * route through `role`'s team — but `team_membership` lacks `church_id`, so we
 * constrain it to the church's role ids (PostgREST `.in`).
 */
export async function getRoleBalanceInputs(): Promise<{
  roles: RoleRef[];
  qualifications: RoleQualification[];
  targets: RoleTarget[];
}> {
  const churchId = await getCurrentChurchId();
  if (!churchId) return { roles: [], qualifications: [], targets: [] };
  const supabase = await createClient();

  // Roles via their team (team has church_id; role does not).
  const { data: roleData, error: roleErr } = await supabase
    .from("role")
    .select("id, name, recruit_target, team:team_id!inner(name, church_id)")
    .eq("team.church_id", churchId);
  if (roleErr) throw roleErr;

  const roleRows = (roleData ?? []) as unknown as RoleRowDb[];
  const roles: RoleRef[] = roleRows.map((r) => ({
    roleId: r.id,
    roleName: r.name,
    teamName: r.team?.name ?? null,
  }));
  const targets: RoleTarget[] = roleRows
    .filter((r) => r.recruit_target != null)
    .map((r) => ({ roleId: r.id, target: r.recruit_target as number }));

  const roleIds = roleRows.map((r) => r.id);
  if (roleIds.length === 0) return { roles, qualifications: [], targets };

  const { data: qualData, error: qualErr } = await supabase
    .from("team_membership")
    .select("role_id, member_id, member:member_id(status)")
    .in("role_id", roleIds);
  if (qualErr) throw qualErr;

  const qualifications: RoleQualification[] = ((qualData ?? []) as unknown as (QualEmbed & {
    member_id: string;
  })[]).map((q) => ({
    roleId: q.role_id,
    memberId: q.member_id,
    active: q.member?.status === "active",
  }));

  return { roles, qualifications, targets };
}
