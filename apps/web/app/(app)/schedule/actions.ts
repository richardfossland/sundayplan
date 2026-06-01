"use server";

import { revalidatePath } from "next/cache";
import { autoFill } from "@sundayplan/sdk";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";
import { buildAutoFillSlots } from "@/lib/data/autofill";

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

/**
 * Copy a whole service's roster onto another (PC "drag a week to the next").
 * Active placements from the source land on the target as fresh `pending`
 * proposals — the planner reviews, conflicts re-run automatically. Idempotent
 * via the natural-key upsert, so re-copying never duplicates a person.
 */
export async function copyWeek(fromServiceId: string, toServiceId: string): Promise<void> {
  const churchId = await getCurrentChurchId();
  if (!churchId || fromServiceId === toServiceId) return;
  const supabase = await createClient();
  const { data } = await supabase
    .from("assignment")
    .select("role_id, member_id, status")
    .eq("service_id", fromServiceId);

  const rows = ((data ?? []) as { role_id: string; member_id: string; status: string }[])
    .filter((a) => a.status !== "declined" && a.status !== "removed")
    .map((a) => ({
      church_id: churchId,
      service_id: toServiceId,
      role_id: a.role_id,
      member_id: a.member_id,
      status: "pending",
      created_by: "planner",
    }));

  if (rows.length > 0) {
    await supabase.from("assignment").upsert(rows, { onConflict: "service_id,role_id,member_id" });
  }
  revalidatePath("/schedule");
}

/** Clear a slot — hard-delete so the cell becomes assignable again. */
export async function removeAssignment(assignmentId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("assignment").delete().eq("id", assignmentId);
  revalidatePath("/schedule");
}

/**
 * Auto-fill the open slots with the deterministic scoring orchestrator. Only
 * empty cells are touched (existing assignments are left alone); proposals land
 * as pending, created_by 'auto_fill', so the planner reviews/tweaks from there.
 */
export async function autoFillSchedule(): Promise<void> {
  const churchId = await getCurrentChurchId();
  if (!churchId) return;

  const slots = await buildAutoFillSlots();
  const { assignments } = autoFill(slots);
  if (assignments.length === 0) {
    revalidatePath("/schedule");
    return;
  }

  const supabase = await createClient();
  const rows = assignments.map((a) => ({
    church_id: churchId,
    service_id: a.service_id,
    role_id: a.role_id,
    member_id: a.member_id,
    status: "pending",
    created_by: "auto_fill",
  }));
  await supabase
    .from("assignment")
    .upsert(rows, { onConflict: "service_id,role_id,member_id" });
  revalidatePath("/schedule");
}
