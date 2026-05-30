"use server";

import { revalidatePath } from "next/cache";
import { schemas } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";

export type SettingsFormState = { error: string | null; ok: boolean };

function blankToUndef(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
}

/** Parse a comma/space-separated list of non-negative ints, sorted desc, deduped. */
function parseNumberList(v: FormDataEntryValue | null): number[] {
  const s = typeof v === "string" ? v : "";
  const nums = s
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0);
  return [...new Set(nums)].sort((a, b) => b - a);
}

export async function updateChurchProfile(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const parsed = schemas.ChurchProfileInputSchema.safeParse({
    name: blankToUndef(formData.get("name")) ?? "",
    locale: formData.get("locale") ?? "no",
    timezone: blankToUndef(formData.get("timezone")) ?? "Europe/Oslo",
    denomination: blankToUndef(formData.get("denomination")) ?? null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form.", ok: false };
  }
  const churchId = await getCurrentChurchId();
  if (!churchId) return { error: "No church found for your account.", ok: false };

  const supabase = await createClient();
  // church_planner_update RLS scopes this to the planner's own church.
  const { error } = await supabase.from("church").update(parsed.data).eq("id", churchId);
  if (error) return { error: error.message, ok: false };

  revalidatePath("/settings");
  return { error: null, ok: true };
}

export async function updateChurchSettings(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const parsed = schemas.ChurchSettingsInputSchema.safeParse({
    // Operational
    default_max_assignments_per_month: Number(
      blankToUndef(formData.get("default_max_assignments_per_month")) ?? "2",
    ),
    reminder_cadence: {
      days_before: parseNumberList(formData.get("days_before")),
      hours_before: parseNumberList(formData.get("hours_before")),
    },
    unfilled_warn_days: Number(blankToUndef(formData.get("unfilled_warn_days")) ?? "7"),
    max_consecutive_sundays: Number(
      blankToUndef(formData.get("max_consecutive_sundays")) ?? "3",
    ),
    auto_buy_sms_overage: formData.get("auto_buy_sms_overage") === "on",
    // Licensing
    ccli_license_number: blankToUndef(formData.get("ccli_license_number")) ?? null,
    ccli_size_category: (blankToUndef(formData.get("ccli_size_category")) ?? null) as
      | "A" | "B" | "C" | "D" | "E" | "F" | null,
    ccli_streaming_addon: formData.get("ccli_streaming_addon") === "on",
    tono_license_status: (formData.get("tono_license_status") ?? "none") as
      | "none" | "state_church_blanket" | "direct_agreement" | "application_pending" | "not_applicable",
    tono_customer_id: blankToUndef(formData.get("tono_customer_id")) ?? null,
    tono_streaming_addon: formData.get("tono_streaming_addon") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form.", ok: false };
  }
  const churchId = await getCurrentChurchId();
  if (!churchId) return { error: "No church found for your account.", ok: false };

  const supabase = await createClient();
  // church_settings_write RLS scopes this update to the planner's church.
  const { error } = await supabase
    .from("church_settings")
    .update(parsed.data)
    .eq("church_id", churchId);
  if (error) return { error: error.message, ok: false };

  revalidatePath("/settings");
  revalidatePath("/schedule"); // conflict thresholds changed
  return { error: null, ok: true };
}
