/**
 * Phase 4.3 data layer — church profile + settings for the active church.
 *
 * Both read under the planner's RLS (cookie-bound server client):
 * `church` exposes a member-read / planner-update policy, and
 * `church_settings` mirrors it (read=member, write=planner). The settings row
 * is seeded at onboarding, so it always exists for a provisioned church.
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";
import type { ChurchSettings } from "@sundayplan/shared";

export interface ChurchProfile {
  id: string;
  name: string;
  slug: string;
  plan_tier: "free" | "starter" | "growth" | "network";
  locale: string;
  timezone: string;
  denomination: string | null;
}

export async function getChurchProfile(): Promise<ChurchProfile | null> {
  const churchId = await getCurrentChurchId();
  if (!churchId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("church")
    .select("id, name, slug, plan_tier, locale, timezone, denomination")
    .eq("id", churchId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChurchProfile | null) ?? null;
}

export async function getChurchSettings(): Promise<ChurchSettings | null> {
  const churchId = await getCurrentChurchId();
  if (!churchId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("church_settings")
    .select("*")
    .eq("church_id", churchId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChurchSettings | null) ?? null;
}
