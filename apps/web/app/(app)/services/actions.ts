"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { schemas } from "@sundayplan/shared";
import type { ServiceItemKind, TemplateItemKind } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";
import { getTemplateDetail } from "@/lib/data/services";

export type ServiceFormState = { error: string | null };
export type ItemState = { error: string | null };

function blankToUndef(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
}

/**
 * A datetime-local value is `YYYY-MM-DDTHH:mm` with no zone. The whole app is
 * UTC-wall-clock (the schedule grid labels services with getUTC*), so we treat
 * the entered time as UTC by appending `Z` — that round-trips exactly with the
 * edit form, which slices the stored ISO back to the same 16 chars.
 */
function toIsoUtc(local: string | undefined): string | undefined {
  if (!local) return undefined;
  const d = new Date(`${local}:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

// Template sections are coarser than service items; collapse to the item kinds.
const TEMPLATE_TO_ITEM_KIND: Record<TemplateItemKind, ServiceItemKind> = {
  welcome: "welcome",
  worship_set: "song",
  scripture: "scripture",
  sermon: "sermon",
  response: "song",
  closing: "announcement",
  announcement: "announcement",
  gap: "gap",
};

function parseServiceForm(formData: FormData) {
  return schemas.ServiceInputSchema.safeParse({
    name: blankToUndef(formData.get("name")) ?? "",
    starts_at_utc: toIsoUtc(blankToUndef(formData.get("starts_at_local"))) ?? "",
    notes: blankToUndef(formData.get("notes")),
    template_id: blankToUndef(formData.get("template_id")),
  });
}

export async function createService(
  _prev: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  const parsed = parseServiceForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  const churchId = await getCurrentChurchId();
  if (!churchId) return { error: "No church found for your account." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service")
    .insert({ ...parsed.data, church_id: churchId })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const serviceId = data.id as string;

  // Seed the order of service from the template, if one was chosen.
  if (parsed.data.template_id) {
    const template = await getTemplateDetail(parsed.data.template_id);
    if (template && template.items.length > 0) {
      const rows = template.items.map((it, i) => ({
        service_id: serviceId,
        position: i,
        label: it.label,
        kind: TEMPLATE_TO_ITEM_KIND[it.kind],
        duration_min: it.duration_min,
      }));
      // Best-effort: a failed seed shouldn't strand the created service.
      await supabase.from("service_item").insert(rows);
    }
  }

  revalidatePath("/services");
  revalidatePath("/schedule");
  redirect(`/services/${serviceId}`);
}

export async function updateService(
  id: string,
  _prev: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  const parsed = parseServiceForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  const supabase = await createClient();
  // RLS (service_planner_all) scopes the update to the planner's church.
  const { error } = await supabase
    .from("service")
    .update({
      name: parsed.data.name,
      starts_at_utc: parsed.data.starts_at_utc,
      notes: parsed.data.notes ?? null,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/services");
  revalidatePath(`/services/${id}`);
  revalidatePath("/schedule");
  redirect(`/services/${id}`);
}

// ── Order of service (service_item) ──────────────────────────────────────────

/** Append an item to the end of the order of service. */
export async function addServiceItem(
  serviceId: string,
  _prev: ItemState,
  formData: FormData,
): Promise<ItemState> {
  const supabase = await createClient();

  const { data: last, error: posErr } = await supabase
    .from("service_item")
    .select("position")
    .eq("service_id", serviceId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (posErr) return { error: posErr.message };
  const nextPosition = (last?.position ?? -1) + 1;

  const kind = formData.get("kind") ?? "welcome";
  const parsed = schemas.ServiceItemInputSchema.safeParse({
    position: nextPosition,
    label: blankToUndef(formData.get("label")) ?? "",
    kind,
    duration_min: Number(formData.get("duration_min") ?? 0),
    notes: blankToUndef(formData.get("notes")),
    scripture_ref: blankToUndef(formData.get("scripture_ref")),
    // Only a song item carries a library reference.
    song_id: kind === "song" ? blankToUndef(formData.get("song_id")) : undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the item." };
  }

  const { error } = await supabase
    .from("service_item")
    .insert({ service_id: serviceId, ...parsed.data });
  if (error) return { error: error.message };

  revalidatePath(`/services/${serviceId}`);
  return { error: null };
}

/** Edit one item's label / duration / notes / scripture ref. */
export async function updateServiceItem(
  serviceId: string,
  itemId: string,
  _prev: ItemState,
  formData: FormData,
): Promise<ItemState> {
  const supabase = await createClient();
  const kind = formData.get("kind") ?? "welcome";
  const parsed = schemas.ServiceItemInputSchema.omit({ position: true }).safeParse({
    label: blankToUndef(formData.get("label")) ?? "",
    kind,
    duration_min: Number(formData.get("duration_min") ?? 0),
    notes: blankToUndef(formData.get("notes")),
    scripture_ref: blankToUndef(formData.get("scripture_ref")),
    song_id: kind === "song" ? blankToUndef(formData.get("song_id")) : undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the item." };
  }
  const { error } = await supabase
    .from("service_item")
    .update({
      label: parsed.data.label,
      kind: parsed.data.kind,
      duration_min: parsed.data.duration_min,
      notes: parsed.data.notes ?? null,
      scripture_ref: parsed.data.scripture_ref ?? null,
      // Clear the song link when the item is no longer a song.
      song_id: parsed.data.kind === "song" ? parsed.data.song_id ?? null : null,
    })
    .eq("id", itemId);
  if (error) return { error: error.message };

  revalidatePath(`/services/${serviceId}`);
  return { error: null };
}

export async function removeServiceItem(serviceId: string, itemId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("service_item").delete().eq("id", itemId);
  revalidatePath(`/services/${serviceId}`);
}

/**
 * Swap an item with its neighbour in the given direction. The
 * unique(service_id, position) constraint forbids a direct swap, so we park the
 * moved item at a temporary position first, then take the neighbour's slot.
 */
export async function moveServiceItem(
  serviceId: string,
  itemId: string,
  direction: "up" | "down",
): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service_item")
    .select("id, position")
    .eq("service_id", serviceId)
    .order("position");
  if (error || !data) return;

  const ordered = data as { id: string; position: number }[];
  const idx = ordered.findIndex((i) => i.id === itemId);
  if (idx === -1) return;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= ordered.length) return;

  const a = ordered[idx];
  const b = ordered[swapIdx];
  // -1 is never a real position (positions are >= 0), so it's a safe parking slot.
  await supabase.from("service_item").update({ position: -1 }).eq("id", a.id);
  await supabase.from("service_item").update({ position: a.position }).eq("id", b.id);
  await supabase.from("service_item").update({ position: b.position }).eq("id", a.id);

  revalidatePath(`/services/${serviceId}`);
}
