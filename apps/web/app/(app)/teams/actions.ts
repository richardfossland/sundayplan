"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
