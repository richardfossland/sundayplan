"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { schemas, type MemberStatus } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";

export type MemberFormState = { error: string | null };

/** Treat blank form fields as "absent" so optional schema fields pass. */
function blankToUndef(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
}

function parseMemberForm(formData: FormData) {
  const target = blankToUndef(formData.get("target_serves_per_month"));
  return schemas.MemberInputSchema.safeParse({
    display_name: blankToUndef(formData.get("display_name")) ?? "",
    phone_e164: blankToUndef(formData.get("phone_e164")),
    email: blankToUndef(formData.get("email")),
    preferred_channel: formData.get("preferred_channel") ?? "sms",
    status: formData.get("status") ?? "active",
    target_serves_per_month: target === undefined ? undefined : Number(target),
    household: blankToUndef(formData.get("household")) ?? null,
  });
}

/** Map common Postgres errors to a friendly message. */
function friendly(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "A member with that phone number already exists.";
  return error.message;
}

export async function createMember(
  _prev: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  const parsed = parseMemberForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  const churchId = await getCurrentChurchId();
  if (!churchId) return { error: "No church found for your account." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("member")
    .insert({ ...parsed.data, church_id: churchId });
  if (error) return { error: friendly(error) };

  revalidatePath("/people");
  redirect("/people");
}

export async function updateMember(
  id: string,
  _prev: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  const parsed = parseMemberForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  const supabase = await createClient();
  // RLS (member_planner_all) scopes the update to the planner's church.
  const { error } = await supabase.from("member").update(parsed.data).eq("id", id);
  if (error) return { error: friendly(error) };

  revalidatePath("/people");
  revalidatePath(`/people/${id}`);
  redirect(`/people/${id}`);
}

/** Quick status flip — archive an inactive volunteer or reactivate them. */
export async function setMemberStatus(id: string, status: MemberStatus): Promise<void> {
  const supabase = await createClient();
  const patch: { status: MemberStatus; archived_at?: string | null } = { status };
  if (status === "archived") patch.archived_at = new Date().toISOString();
  if (status === "active") patch.archived_at = null;
  await supabase.from("member").update(patch).eq("id", id);
  revalidatePath("/people");
  revalidatePath(`/people/${id}`);
}
