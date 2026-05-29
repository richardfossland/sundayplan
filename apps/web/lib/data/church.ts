/**
 * Current-church helper. Reads run under RLS scoped to the planner's church
 * automatically, but writes need the church_id explicitly — every owned row
 * carries it. This resolves it from the signed-in user's membership.
 */
import { createClient } from "@/lib/supabase/server";

export async function getCurrentChurchId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("church_member")
    .select("church_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  return (data?.church_id as string | undefined) ?? null;
}
