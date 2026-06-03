"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseCredentialInput } from "@sundayplan/sdk";
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

// ── Member credentials (background-check / certification gating) ──────────────

export type CredentialState = { error: string | null };

/**
 * Add or update one credential for a member. There's a unique (member_id, kind)
 * row, so we upsert on that key — re-saving the same kind edits in place. The
 * church_id is resolved server-side (never trusted from the form), and the
 * RLS policy (member_credential_planner_all) double-checks it on write.
 */
export async function saveMemberCredential(
  memberId: string,
  _prev: CredentialState,
  formData: FormData,
): Promise<CredentialState> {
  const parsed = parseCredentialInput({
    kind: formData.get("kind"),
    status: formData.get("status"),
    issued_at: formData.get("issued_at"),
    expires_at: formData.get("expires_at"),
    notes: formData.get("notes"),
  });
  if (!parsed.ok) return { error: parsed.error };

  const churchId = await getCurrentChurchId();
  if (!churchId) return { error: "No church found for your account." };

  const supabase = await createClient();
  const { error } = await supabase.from("member_credential").upsert(
    { member_id: memberId, church_id: churchId, ...parsed.value },
    { onConflict: "member_id,kind" },
  );
  if (error) return { error: error.message };

  revalidatePath(`/people/${memberId}`);
  revalidatePath("/schedule");
  return { error: null };
}

/** Remove a credential record. RLS scopes the delete to the planner's church. */
export async function deleteMemberCredential(
  memberId: string,
  credentialId: string,
): Promise<void> {
  const supabase = await createClient();
  await supabase.from("member_credential").delete().eq("id", credentialId);
  revalidatePath(`/people/${memberId}`);
  revalidatePath("/schedule");
}
