"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";

/**
 * Assign a member to a (service, role) slot. Upserts on the natural key so
 * re-assigning a member who was previously removed just flips them back to
 * pending rather than tripping the unique (service_id, role_id, member_id).
 */
export async function createAssignment(
  serviceId: string,
  roleId: string,
  memberId: string,
): Promise<void> {
  const churchId = await getCurrentChurchId();
  if (!churchId) return;
  const supabase = await createClient();
  // RLS (assignment_planner_all) scopes this to the planner's church.
  await supabase.from("assignment").upsert(
    {
      church_id: churchId,
      service_id: serviceId,
      role_id: roleId,
      member_id: memberId,
      status: "pending",
      created_by: "planner",
    },
    { onConflict: "service_id,role_id,member_id" },
  );
  revalidatePath("/schedule");
}

/** Clear a slot — hard-delete so the cell becomes assignable again. */
export async function removeAssignment(assignmentId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("assignment").delete().eq("id", assignmentId);
  revalidatePath("/schedule");
}
