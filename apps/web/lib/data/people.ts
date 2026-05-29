/**
 * People data layer — real Supabase queries behind the cookie-bound server
 * client, so every read runs under the signed-in planner's RLS (scoped to
 * their church). Replaces the `buildPeople`/`getPerson` mock for the People
 * registry. The dashboard demo still uses lib/mock.ts for the SDK-engine
 * showcase until those reads are wired too.
 */
import { createClient } from "@/lib/supabase/server";
import type {
  AssignmentStatus,
  ContactChannel,
  MemberStatus,
  SkillLevel,
} from "@sundayplan/shared";

export interface PersonRow {
  id: string;
  name: string;
  teams: string[];
  skill: SkillLevel;
  last_served: string | null; // ISO date
  status: MemberStatus;
  phone: string | null;
  channel: ContactChannel;
}

export interface PersonAssignment {
  service_label: string;
  role: string;
  status: AssignmentStatus;
}

const SKILL_RANK: Record<SkillLevel, number> = {
  training: 0,
  capable: 1,
  lead: 2,
  trainer: 3,
};

/** A member's headline skill = the highest level across their team roles. */
function highestSkill(levels: SkillLevel[]): SkillLevel {
  if (levels.length === 0) return "capable";
  return levels.reduce((best, s) => (SKILL_RANK[s] > SKILL_RANK[best] ? s : best));
}

/** Shape of an embedded team_membership row from the `member` select. */
interface MembershipEmbed {
  skill_level: SkillLevel;
  team: { name: string } | null;
}

interface MemberEmbed {
  id: string;
  display_name: string;
  status: MemberStatus;
  phone_e164: string | null;
  preferred_channel: ContactChannel;
  team_membership: MembershipEmbed[] | null;
}

const MEMBER_SELECT =
  "id, display_name, status, phone_e164, preferred_channel, team_membership(skill_level, team(name))";

function toPersonRow(m: MemberEmbed): PersonRow {
  const memberships = m.team_membership ?? [];
  const teams = [
    ...new Set(
      memberships
        .map((tm) => tm.team?.name)
        .filter((n): n is string => Boolean(n)),
    ),
  ];
  return {
    id: m.id,
    name: m.display_name,
    teams,
    skill: highestSkill(memberships.map((tm) => tm.skill_level)),
    // last_served needs a past accepted assignment; all seeded services are
    // upcoming, so this stays null until the assignment history grows.
    last_served: null,
    status: m.status,
    phone: m.phone_e164,
    channel: m.preferred_channel,
  };
}

/** All members in the planner's church, alphabetical. */
export async function getPeople(): Promise<PersonRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member")
    .select(MEMBER_SELECT)
    .order("display_name");
  if (error) throw error;
  return ((data ?? []) as unknown as MemberEmbed[]).map(toPersonRow);
}

/** One member by id, or null if not found / not visible under RLS. */
export async function getPerson(id: string): Promise<PersonRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member")
    .select(MEMBER_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toPersonRow(data as unknown as MemberEmbed) : null;
}

interface AssignmentEmbed {
  status: AssignmentStatus;
  service: { name: string; starts_at_utc: string } | null;
  role: { name: string } | null;
}

/** A member's assignments, soonest service first. */
export async function getPersonSchedule(id: string): Promise<PersonAssignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assignment")
    .select("status, service(name, starts_at_utc), role(name)")
    .eq("member_id", id);
  if (error) throw error;
  return ((data ?? []) as unknown as AssignmentEmbed[])
    .sort((a, b) =>
      (a.service?.starts_at_utc ?? "").localeCompare(b.service?.starts_at_utc ?? ""),
    )
    .map((a) => ({
      service_label: a.service?.name ?? "—",
      role: a.role?.name ?? "—",
      status: a.status,
    }));
}
