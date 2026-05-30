"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";

export type HolidayState = { error: string | null; count: number | null };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Mark a church-wide holiday: write one unavailability record per member so the
 * whole church reads as unavailable on a date (or date range). These are the
 * same `availability` rows the scoring + conflict engines use, so auto-fill and
 * warnings respect them immediately.
 */
export async function markChurchHoliday(
  _prev: HolidayState,
  formData: FormData,
): Promise<HolidayState> {
  const from = String(formData.get("from") ?? "").trim();
  const toRaw = String(formData.get("to") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const scope = formData.get("scope") === "all" ? "all" : "active";

  if (!ISO_DATE.test(from)) return { error: "Pick a start date.", count: null };
  const to = ISO_DATE.test(toRaw) ? toRaw : null;
  if (to && to < from) return { error: "The end date is before the start date.", count: null };

  const churchId = await getCurrentChurchId();
  if (!churchId) return { error: "No church found for your account.", count: null };

  const supabase = await createClient();
  let q = supabase.from("member").select("id").eq("church_id", churchId);
  if (scope === "active") q = q.eq("status", "active");
  const { data: members, error: memErr } = await q;
  if (memErr) return { error: memErr.message, count: null };
  if (!members || members.length === 0) return { error: "No members to mark.", count: null };

  const pattern = to ? { from, to } : { dates: [from] };
  const kind = to ? "range" : "specific";
  const rows = members.map((m) => ({
    member_id: m.id as string,
    kind,
    pattern,
    reason,
    reason_visibility: "planner" as const,
  }));

  const { error } = await supabase.from("availability").insert(rows);
  if (error) return { error: error.message, count: null };

  revalidatePath("/schedule");
  revalidatePath("/people");
  return { error: null, count: rows.length };
}
