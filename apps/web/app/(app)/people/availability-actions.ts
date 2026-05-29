"use server";

import { revalidatePath } from "next/cache";
import { schemas } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/server";

export type AvailabilityState = { error: string | null };

function blankToUndef(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
}

/** Build the pattern object the schema expects from the kind + its inputs. */
function buildPattern(kind: string, formData: FormData): unknown {
  switch (kind) {
    case "recurring":
      return { weekday: formData.get("weekday") };
    case "range":
      return { from: blankToUndef(formData.get("from")), to: blankToUndef(formData.get("to")) };
    case "specific": {
      const date = blankToUndef(formData.get("date"));
      return { dates: date ? [date] : [] };
    }
    default:
      return {};
  }
}

export async function addAvailability(
  memberId: string,
  _prev: AvailabilityState,
  formData: FormData,
): Promise<AvailabilityState> {
  const kind = (formData.get("kind") as string) ?? "specific";
  const parsed = schemas.AvailabilityInputSchema.safeParse({
    member_id: memberId,
    kind,
    pattern: buildPattern(kind, formData),
    reason: blankToUndef(formData.get("reason")),
    reason_visibility: formData.get("reason_visibility") ?? "planner",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the dates you entered." };
  }
  // A range that ends before it starts is valid Zod but meaningless.
  const p = parsed.data.pattern as Record<string, string>;
  if (parsed.data.kind === "range" && p.from > p.to) {
    return { error: "The end date is before the start date." };
  }

  const supabase = await createClient();
  // RLS (availability_member_or_planner) allows the planner to write for any
  // member in their church.
  const { error } = await supabase.from("availability").insert(parsed.data);
  if (error) return { error: error.message };

  revalidatePath(`/people/${memberId}`);
  revalidatePath("/schedule");
  return { error: null };
}

export async function removeAvailability(memberId: string, availabilityId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("availability").delete().eq("id", availabilityId);
  revalidatePath(`/people/${memberId}`);
  revalidatePath("/schedule");
}
