/**
 * Auth-guard / church-scoping for SundayBooking.
 *
 * Every API route and server page resolves the caller's identity + church
 * membership through the user-scoped (RLS) Supabase client BEFORE touching the
 * service-role client. The service-role client bypasses RLS, so the church_id
 * we pass into the booking RPCs must come from a verified membership — never
 * from the request body — otherwise a member of church A could act on church B.
 *
 * Coarse roles live on `public.church_member.role` (migration 0001):
 *   'admin' | 'planner' | 'team_lead' | 'viewer'
 * Mirroring `public.is_planner_of`, planner-level = admin OR planner.
 */
import { createClient } from "@/lib/supabase/server";

export type ChurchRole = "admin" | "planner" | "team_lead" | "viewer";

const PLANNER_ROLES: ReadonlySet<ChurchRole> = new Set(["admin", "planner"]);

export type AuthedContext = {
  userId: string;
  churchId: string;
  role: ChurchRole;
  /** admin | planner — may approve/decline and CRUD resources/event-types. */
  isPlanner: boolean;
};

/**
 * Resolve the signed-in user's primary church membership.
 * Returns null when there is no session or no membership.
 */
export async function getAuthedContext(): Promise<AuthedContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("church_member")
    .select("church_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!data?.church_id) return null;

  const role = (data.role as ChurchRole | undefined) ?? "viewer";
  return {
    userId: user.id,
    churchId: data.church_id as string,
    role,
    isPlanner: PLANNER_ROLES.has(role),
  };
}

export type GuardResult =
  | { ok: true; ctx: AuthedContext }
  | { ok: false; status: 401 | 403; error: string };

/** Require any authenticated church member (read / request a booking). */
export async function requireMember(): Promise<GuardResult> {
  const ctx = await getAuthedContext();
  if (!ctx) return { ok: false, status: 401, error: "not_authenticated" };
  return { ok: true, ctx };
}

/** Require planner-level access (approve/decline/cancel, resource + event CRUD). */
export async function requirePlanner(): Promise<GuardResult> {
  const ctx = await getAuthedContext();
  if (!ctx) return { ok: false, status: 401, error: "not_authenticated" };
  if (!ctx.isPlanner) return { ok: false, status: 403, error: "forbidden" };
  return { ok: true, ctx };
}
