"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { schemas } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";

export type TemplateFormState = { error: string | null };
export type RowState = { error: string | null };

function blankToUndef(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
}

function parseTemplateForm(formData: FormData) {
  return schemas.ServiceTemplateInputSchema.safeParse({
    name: blankToUndef(formData.get("name")) ?? "",
    default_duration_min: Number(formData.get("default_duration_min") ?? 75),
  });
}

export async function createTemplate(
  _prev: TemplateFormState,
  formData: FormData,
): Promise<TemplateFormState> {
  const parsed = parseTemplateForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  const churchId = await getCurrentChurchId();
  if (!churchId) return { error: "No church found for your account." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service_template")
    .insert({ ...parsed.data, church_id: churchId })
    .select("id")
    .single();
  if (error) {
    return { error: error.code === "23505" ? "A template with that name already exists." : error.message };
  }

  revalidatePath("/services/templates");
  redirect(`/services/templates/${data.id}`);
}

export async function updateTemplate(
  id: string,
  _prev: TemplateFormState,
  formData: FormData,
): Promise<TemplateFormState> {
  const parsed = parseTemplateForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("service_template").update(parsed.data).eq("id", id);
  if (error) {
    return { error: error.code === "23505" ? "A template with that name already exists." : error.message };
  }

  revalidatePath("/services/templates");
  revalidatePath(`/services/templates/${id}`);
  redirect(`/services/templates/${id}`);
}

// ── Template items (composite PK: template_id + position) ─────────────────────

export async function addTemplateItem(
  templateId: string,
  _prev: RowState,
  formData: FormData,
): Promise<RowState> {
  const supabase = await createClient();
  const { data: last, error: posErr } = await supabase
    .from("template_item")
    .select("position")
    .eq("template_id", templateId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (posErr) return { error: posErr.message };
  const nextPosition = (last?.position ?? -1) + 1;

  const parsed = schemas.TemplateItemInputSchema.safeParse({
    position: nextPosition,
    label: blankToUndef(formData.get("label")) ?? "",
    kind: formData.get("kind") ?? "welcome",
    duration_min: Number(formData.get("duration_min") ?? 0),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the item." };
  }
  const { error } = await supabase
    .from("template_item")
    .insert({ template_id: templateId, ...parsed.data });
  if (error) return { error: error.message };

  revalidatePath(`/services/templates/${templateId}`);
  return { error: null };
}

export async function updateTemplateItem(
  templateId: string,
  position: number,
  _prev: RowState,
  formData: FormData,
): Promise<RowState> {
  const parsed = schemas.TemplateItemInputSchema.omit({ position: true }).safeParse({
    label: blankToUndef(formData.get("label")) ?? "",
    kind: formData.get("kind") ?? "welcome",
    duration_min: Number(formData.get("duration_min") ?? 0),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the item." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("template_item")
    .update(parsed.data)
    .eq("template_id", templateId)
    .eq("position", position);
  if (error) return { error: error.message };

  revalidatePath(`/services/templates/${templateId}`);
  return { error: null };
}

export async function removeTemplateItem(templateId: string, position: number): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("template_item")
    .delete()
    .eq("template_id", templateId)
    .eq("position", position);
  revalidatePath(`/services/templates/${templateId}`);
}

/** Swap an item with its neighbour. Position is part of the PK, so park the
 *  moved row at -1 first to dodge the (template_id, position) uniqueness. */
export async function moveTemplateItem(
  templateId: string,
  position: number,
  direction: "up" | "down",
): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("template_item")
    .select("position")
    .eq("template_id", templateId)
    .order("position");
  if (error || !data) return;

  const positions = (data as { position: number }[]).map((r) => r.position);
  const idx = positions.indexOf(position);
  if (idx === -1) return;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= positions.length) return;
  const a = positions[idx];
  const b = positions[swapIdx];

  // Park the row at `a` on -1, slide `b` into a, then settle the parked row at b.
  await supabase.from("template_item").update({ position: -1 }).eq("template_id", templateId).eq("position", a);
  await supabase.from("template_item").update({ position: a }).eq("template_id", templateId).eq("position", b);
  await supabase.from("template_item").update({ position: b }).eq("template_id", templateId).eq("position", -1);

  revalidatePath(`/services/templates/${templateId}`);
}

// ── Role requirements (composite PK: template_id + role_id) ───────────────────

export async function setRequirement(
  templateId: string,
  _prev: RowState,
  formData: FormData,
): Promise<RowState> {
  const parsed = schemas.ServiceTeamRequirementInputSchema.safeParse({
    role_id: blankToUndef(formData.get("role_id")),
    quantity: Number(formData.get("quantity") ?? 1),
  });
  if (!parsed.success) {
    return { error: "Pick a role and a valid quantity." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("service_team_requirement")
    .upsert(
      { template_id: templateId, role_id: parsed.data.role_id, quantity: parsed.data.quantity },
      { onConflict: "template_id,role_id" },
    );
  if (error) return { error: error.message };

  revalidatePath(`/services/templates/${templateId}`);
  revalidatePath("/schedule");
  return { error: null };
}

export async function removeRequirement(templateId: string, roleId: string): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("service_team_requirement")
    .delete()
    .eq("template_id", templateId)
    .eq("role_id", roleId);
  revalidatePath(`/services/templates/${templateId}`);
  revalidatePath("/schedule");
}
