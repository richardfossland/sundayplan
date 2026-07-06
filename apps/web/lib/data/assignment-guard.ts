import "server-only";

import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Verify a (service, role, member) triple all belong to `churchId` before an
 * assignment write.
 *
 * The `assignment` table's FKs to service/role/member do NOT constrain them to
 * share the row's church, and `assignment_planner_all` RLS only checks the
 * denormalized `church_id` column. So a planner of church A who stamps their own
 * churchId onto a row could otherwise point `service_id`/`role_id`/`member_id`
 * at church B's data (cross-tenant corruption). We re-derive each id's church
 * and require it to match. `service`/`member` carry `church_id` directly; `role`
 * is church-scoped via its `team`. Under the planner's RLS these reads already
 * return nothing for another church, so a foreign id resolves to null → false.
 */
export async function assignmentTargetsInChurch(
  supabase: Client,
  churchId: string,
  serviceId: string,
  roleId: string,
  memberId: string,
): Promise<boolean> {
  const [svc, mem, role] = await Promise.all([
    supabase.from("service").select("church_id").eq("id", serviceId).maybeSingle(),
    supabase.from("member").select("church_id").eq("id", memberId).maybeSingle(),
    supabase.from("role").select("team_id").eq("id", roleId).maybeSingle(),
  ]);
  if (svc.data?.church_id !== churchId) return false;
  if (mem.data?.church_id !== churchId) return false;
  const teamId = role.data?.team_id as string | undefined;
  if (!teamId) return false;
  const team = await supabase.from("team").select("church_id").eq("id", teamId).maybeSingle();
  return team.data?.church_id === churchId;
}

/** Same as {@link assignmentTargetsInChurch} but validates only the target
 * service (used by copyWeek, whose role/member come from an RLS-scoped read of
 * the source service and are therefore already the caller's own church). */
export async function serviceInChurch(
  supabase: Client,
  churchId: string,
  serviceId: string,
): Promise<boolean> {
  const svc = await supabase
    .from("service")
    .select("church_id")
    .eq("id", serviceId)
    .maybeSingle();
  return svc.data?.church_id === churchId;
}
