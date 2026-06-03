/**
 * People data layer — real Supabase queries behind the cookie-bound server
 * client, so every read runs under the signed-in planner's RLS (scoped to
 * their church). Replaces the `buildPeople`/`getPerson` mock for the People
 * registry. The dashboard demo still uses lib/mock.ts for the SDK-engine
 * showcase until those reads are wired too.
 */
import { createClient } from "@/lib/supabase/server";
import type { CredentialKind, CredentialStatus } from "@sundayplan/sdk";
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
  tags: string[];
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
  tags: string[] | null;
  team_membership: MembershipEmbed[] | null;
}

const MEMBER_SELECT =
  "id, display_name, status, phone_e164, preferred_channel, tags, team_membership(skill_level, team(name))";

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
    tags: m.tags ?? [],
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

export interface MemberOption {
  id: string;
  name: string;
}

/** Lightweight {id, name} list of active members — for pickers. */
export async function getChurchMemberOptions(): Promise<MemberOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member")
    .select("id, display_name")
    .eq("status", "active")
    .order("display_name");
  if (error) throw error;
  return ((data ?? []) as { id: string; display_name: string }[]).map((m) => ({
    id: m.id,
    name: m.display_name,
  }));
}

export interface MemberEditable {
  id: string;
  display_name: string;
  phone_e164: string | null;
  email: string | null;
  preferred_channel: ContactChannel;
  status: MemberStatus;
  target_serves_per_month: number | null;
  household: string | null;
}

/** Raw editable member fields for the edit form (not the display projection). */
export async function getMemberEditable(id: string): Promise<MemberEditable | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member")
    .select(
      "id, display_name, phone_e164, email, preferred_channel, status, target_serves_per_month, household",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as MemberEditable | null) ?? null;
}

interface AssignmentEmbed {
  status: AssignmentStatus;
  service: { name: string; starts_at_utc: string } | null;
  role: { name: string } | null;
}

export interface CredentialRow {
  id: string;
  kind: CredentialKind;
  status: CredentialStatus;
  issued_at: string | null; // ISO date
  expires_at: string | null; // ISO date
  notes: string | null;
}

/**
 * A member's credentials (background-check / certifications). RLS
 * (member_credential_planner_all) scopes the read to the planner's church, so a
 * planner only ever sees their own members' records.
 */
export async function getMemberCredentials(memberId: string): Promise<CredentialRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_credential")
    .select("id, kind, status, issued_at, expires_at, notes")
    .eq("member_id", memberId)
    .order("kind");
  if (error) throw error;
  return (data ?? []) as CredentialRow[];
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
