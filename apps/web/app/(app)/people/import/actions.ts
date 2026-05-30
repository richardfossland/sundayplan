"use server";

import { revalidatePath } from "next/cache";
import { parseMemberImport } from "@sundayplan/sdk";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";

export interface ImportSummary {
  inserted: number;
  skippedExisting: number;
  duplicates: number;
  errors: { line: number; message: string }[];
}

export type ImportState = { error: string | null; summary: ImportSummary | null };

export async function importMembers(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const text = String(formData.get("paste") ?? "");
  const parsed = parseMemberImport(text);
  if (parsed.rows.length === 0) {
    return {
      error: parsed.errors.length > 0 ? "No valid rows — fix the flagged lines." : "Nothing to import.",
      summary: { inserted: 0, skippedExisting: 0, duplicates: parsed.duplicates, errors: parsed.errors },
    };
  }

  const churchId = await getCurrentChurchId();
  if (!churchId) return { error: "No church found for your account.", summary: null };

  const supabase = await createClient();

  // Drop rows whose phone already exists in this church (the DB unique index
  // would reject the whole batch otherwise) — report them as skipped, not errors.
  const phones = parsed.rows.map((r) => r.phone_e164).filter((p): p is string => Boolean(p));
  let existing = new Set<string>();
  if (phones.length > 0) {
    const { data } = await supabase
      .from("member")
      .select("phone_e164")
      .in("phone_e164", phones);
    existing = new Set((data ?? []).map((m) => m.phone_e164 as string));
  }

  const toInsert = parsed.rows.filter((r) => !(r.phone_e164 && existing.has(r.phone_e164)));
  const skippedExisting = parsed.rows.length - toInsert.length;

  let inserted = 0;
  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from("member")
      .insert(toInsert.map((r) => ({ ...r, church_id: churchId })))
      .select("id");
    if (error) return { error: error.message, summary: null };
    inserted = data?.length ?? 0;
    revalidatePath("/people");
  }

  return {
    error: null,
    summary: { inserted, skippedExisting, duplicates: parsed.duplicates, errors: parsed.errors },
  };
}
