"use server";

import { revalidatePath } from "next/cache";
import { autoFill, balancedAutoFill, type FairnessSummary } from "@sundayplan/sdk";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";
import { buildAutoFillSlots } from "@/lib/data/autofill";

/**
 * Apply the change set the Pastor's-chat agent proposed and the planner
 * accepted. CRITICAL: we do NOT trust the model's posted assignments — we
 * RE-RUN the deterministic engine server-side and write THAT, so the model can
 * never inject a person it didn't legitimately earn through the engine. `balanced`
 * selects the same flattening pass the agent narrated. Identical write semantics
 * to {@link autoFillSchedule}: only empty cells, proposals land pending/'auto_fill'.
 */
export async function applyAgentProposal(balanced: boolean): Promise<void> {
  const churchId = await getCurrentChurchId();
  if (!churchId) return;

  const { slots, minRestDays } = await buildAutoFillSlots(
    new Date(),
    balanced ? { withWindowPriors: true } : {},
  );
  const { assignments } = balanced
    ? balancedAutoFill(slots, { minRestDays })
    : autoFill(slots, { minRestDays });
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
  await supabase.from("assignment").upsert(rows, { onConflict: "service_id,role_id,member_id" });
  revalidatePath("/schedule");
}

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

  const { slots, minRestDays } = await buildAutoFillSlots();
  const { assignments } = autoFill(slots, { minRestDays });
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

/**
 * Global-fairness auto-fill (opt-in). Same write semantics as
 * {@link autoFillSchedule} — only empty cells are touched, proposals land as
 * pending/'auto_fill' for the planner to review — but the proposal set comes
 * from `balancedAutoFill`, which flattens volunteer load across the whole
 * window after the greedy pass (reducing burnout) without introducing a hard
 * conflict or materially lowering fit. Returns the fairness summary so the UI
 * can show what it balanced; the greedy `autoFillSchedule` stays available.
 */
export async function autoFillScheduleBalanced(): Promise<{ fairness: FairnessSummary } | null> {
  const churchId = await getCurrentChurchId();
  if (!churchId) return null;

  const { slots, minRestDays } = await buildAutoFillSlots(new Date(), { withWindowPriors: true });
  const { assignments, fairness } = balancedAutoFill(slots, { minRestDays });
  if (assignments.length === 0) {
    revalidatePath("/schedule");
    return { fairness };
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
  return { fairness };
}
