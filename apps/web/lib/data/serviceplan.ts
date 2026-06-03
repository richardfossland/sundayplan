/**
 * ServicePlan data layer — the canonical, app-agnostic export of a service that
 * the rest of the Sunday suite consumes (SundayStage setlist rendering, SundayRec
 * metadata linking). Binds the SDK's {@link SupabaseServicePlanFetcher} to the
 * cookie-bound server client so the five underlying queries run under the
 * signed-in planner's RLS, scoped to their church.
 *
 * The fetch orchestration + assembly live in the SDK (pure, fully unit-tested);
 * this layer is the thin Supabase binding. The SDK reads through a structural
 * query seam, which the supabase-js builder satisfies as-is.
 */
import {
  SupabaseServicePlanFetcher,
  fetchServicePlan,
  type ServicePlanQueryClient,
  type FetchServicePlanResult,
} from "@sundayplan/sdk";
import { createClient } from "@/lib/supabase/server";

/**
 * Assemble the canonical {@link ServicePlan} for one service, or
 * `{ ok: false, error: "service_not_found" }` when the service isn't visible
 * under the caller's RLS.
 */
export async function getServicePlan(serviceId: string): Promise<FetchServicePlanResult> {
  const supabase = await createClient();
  // supabase-js's query builder structurally satisfies the SDK's query seam.
  const fetcher = new SupabaseServicePlanFetcher(supabase as unknown as ServicePlanQueryClient);
  return fetchServicePlan(fetcher, serviceId);
}
