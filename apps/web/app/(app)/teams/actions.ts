"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseRequiredCredentials } from "@sundayplan/sdk";
import { schemas } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";

export type TeamFormState = { error: string | null };

function blankToUndef(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
}

function parseTeamForm(formData: FormData) {
  return schemas.TeamInputSchema.safeParse({
    name: blankToUndef(formData.get("name")) ?? "",
    color: blankToUndef(formData.get("color")),
    description: blankToUndef(formData.get("description")),
  });
}

function friendly(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "A team with that name already exists.";
  return error.message;
}

export async function createTeam(
  _prev: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const parsed = parseTeamForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  const churchId = await getCurrentChurchId();
  if (!churchId) return { error: "No church found for your account." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("team")
    .insert({ ...parsed.data, church_id: churchId });
  if (error) return { error: friendly(error) };

  revalidatePath("/teams");
  redirect("/teams");
}

export async function updateTeam(
  id: string,
  _prev: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const parsed = parseTeamForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  const supabase = await createClient();
  // RLS (team_planner_all) scopes the update to the planner's church.
  const { error } = await supabase.from("team").update(parsed.data).eq("id", id);
  if (error) return { error: friendly(error) };

  revalidatePath("/teams");
  revalidatePath(`/teams/${id}`);
  redirect(`/teams/${id}`);
}

// ── Roles + memberships (team composition) ───────────────────────────────────

export type CompositionState = { error: string | null };

/** Add a role (with a minimum skill) to a team. */
export async function createRole(
  teamId: string,
  _prev: CompositionState,
  formData: FormData,
): Promise<CompositionState> {
  const parsed = schemas.RoleInputSchema.safeParse({
    name: blankToUndef(formData.get("name")) ?? "",
    skill_required: formData.get("skill_required") ?? "capable",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  const supabase = await createClient();
  // RLS (role_planner_all) checks the team belongs to the planner's church.
  const { error } = await supabase
    .from("role")
    .insert({ team_id: teamId, name: parsed.data.name, skill_required: parsed.data.skill_required });
  if (error) {
    return { error: error.code === "23505" ? "That role already exists on this team." : error.message };
  }
  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/schedule");
  return { error: null };
}

/** Assign a member to a team role (upsert on the composite key). */
export async function addMemberToRole(
  teamId: string,
  roleId: string,
  _prev: CompositionState,
  formData: FormData,
): Promise<CompositionState> {
  const parsed = schemas.TeamMembershipInputSchema.safeParse({
    team_id: teamId,
    role_id: roleId,
    member_id: blankToUndef(formData.get("member_id")),
    skill_level: formData.get("skill_level") ?? "capable",
    is_key_person: formData.get("is_key_person") === "on",
  });
  if (!parsed.success) {
    return { error: "Pick a member first." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("team_membership").upsert(
    {
      team_id: parsed.data.team_id,
      role_id: parsed.data.role_id,
      member_id: parsed.data.member_id,
      skill_level: parsed.data.skill_level,
      is_key_person: parsed.data.is_key_person ?? false,
    },
    { onConflict: "member_id,team_id,role_id" },
  );
  if (error) return { error: error.message };
  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/schedule");
  return { error: null };
}

/** Flip a member's designated-lead (key person) flag for a role. */
export async function setKeyPerson(
  teamId: string,
  roleId: string,
  memberId: string,
  isKey: boolean,
): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("team_membership")
    .update({ is_key_person: isKey })
    .eq("team_id", teamId)
    .eq("role_id", roleId)
    .eq("member_id", memberId);
  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/schedule");
}

/**
 * Set which credential kinds a role requires. The form posts a checkbox per
 * kind (name="required_credentials"); we normalise through the SDK parser so
 * only valid, de-duplicated kinds land in `role.required_credentials`. An empty
 * set clears gating for the role. RLS (role_planner_all) scopes the update.
 */
export async function updateRoleRequiredCredentials(
  teamId: string,
  roleId: string,
  formData: FormData,
): Promise<void> {
  const required = parseRequiredCredentials(formData.getAll("required_credentials"));
  const supabase = await createClient();
  await supabase.from("role").update({ required_credentials: required }).eq("id", roleId);
  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/schedule");
}

/** Remove a member from a team role. */
export async function removeMemberFromRole(
  teamId: string,
  roleId: string,
  memberId: string,
): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("team_membership")
    .delete()
    .eq("team_id", teamId)
    .eq("role_id", roleId)
    .eq("member_id", memberId);
  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/schedule");
}
