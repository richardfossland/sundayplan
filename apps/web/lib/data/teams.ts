/**
 * Teams data layer — real Supabase queries behind the cookie-bound server
 * client (reads run under the signed-in planner's RLS, scoped to their
 * church). Replaces the team mock. Roles come straight from the `role` table,
 * so a role with nobody assigned still shows up — that empty role is exactly
 * the coverage gap the insights flag.
 */
import { createClient } from "@/lib/supabase/server";
import type { SkillLevel } from "@sundayplan/shared";

export interface TeamInfo {
  id: string;
  name: string;
  color: string | null; // hex, straight from the DB
  description: string | null;
}

export interface TeamSummary extends TeamInfo {
  member_count: number;
  role_count: number;
}

export interface TeamRoleGroup {
  id: string;
  role: string;
  skill_required: SkillLevel;
  members: Array<{ id: string; name: string; skill: SkillLevel }>;
}

interface TeamListEmbed extends TeamInfo {
  role: { id: string }[] | null;
  team_membership: { member_id: string }[] | null;
}

/** All teams in the planner's church, with member + role counts. */
export async function getTeams(): Promise<TeamSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team")
    // `role` is reachable two ways (direct FK + via team_membership); pin the
    // direct FK so the embed is unambiguous.
    .select(
      "id, name, color, description, role!role_team_id_fkey(id), team_membership(member_id)",
    )
    .order("name");
  if (error) throw error;
  return ((data ?? []) as unknown as TeamListEmbed[]).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    description: t.description,
    member_count: new Set((t.team_membership ?? []).map((m) => m.member_id)).size,
    role_count: (t.role ?? []).length,
  }));
}

/** One team by id, or null if not found / not visible under RLS. */
export async function getTeam(id: string): Promise<TeamInfo | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team")
    .select("id, name, color, description")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as TeamInfo | null) ?? null;
}

interface RoleEmbed {
  id: string;
  name: string;
  skill_required: SkillLevel;
  team_membership:
    | { skill_level: SkillLevel; member: { id: string; display_name: string } | null }[]
    | null;
}

/** Every role on a team with its assigned members (empty roles included). */
export async function getTeamRoles(id: string): Promise<TeamRoleGroup[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("role")
    .select("id, name, skill_required, team_membership(skill_level, member(id, display_name))")
    .eq("team_id", id)
    .order("name");
  if (error) throw error;
  return ((data ?? []) as unknown as RoleEmbed[]).map((r) => ({
    id: r.id,
    role: r.name,
    skill_required: r.skill_required,
    members: (r.team_membership ?? [])
      .filter((tm) => tm.member)
      .map((tm) => ({
        id: tm.member!.id,
        name: tm.member!.display_name,
        skill: tm.skill_level,
      })),
  }));
}

const HAS_LEAD: SkillLevel[] = ["lead", "trainer"];

/** Coverage insights derived from already-fetched roles (no extra query). */
export function teamInsights(roles: TeamRoleGroup[]): string[] {
  const out: string[] = [];
  for (const g of roles) {
    if (g.members.length === 0) {
      out.push(`${g.role} has nobody assigned.`);
      continue;
    }
    if (g.members.length === 1) {
      out.push(`${g.role} has only one person — a single point of failure.`);
    }
    if (!g.members.some((m) => HAS_LEAD.includes(m.skill))) {
      out.push(`${g.role} has no lead-level cover.`);
    }
  }
  return out;
}
