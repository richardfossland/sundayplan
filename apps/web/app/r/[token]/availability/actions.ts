/**
 * Volunteer blockout self-service (no account). The magic-link token authorizes;
 * we verify it (purpose 'availability_set') and write the member's own
 * availability via the service-role client, scoped to the claim's member_id.
 * These rows feed the scoring + conflict engines immediately, so a planner
 * schedules "without fear of declines" (the Planning Center blockout pattern).
 */
"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifySelfServiceToken, type SelfServiceError } from "@/lib/data/volunteer-self-service";
import { isLocale, DEFAULT_LOCALE, type Locale } from "@/lib/i18n/messages";

export interface Blockout {
  id: string;
  label: string;
  reason: string | null;
}

export type AvailabilityLoad =
  | { ok: true; memberName: string; blockouts: Blockout[]; locale: Locale }
  | { ok: false; error: SelfServiceError | "not_found" };

function patternLabel(kind: string, pattern: Record<string, unknown>): string {
  if (kind === "specific") {
    const dates = (pattern.dates as string[] | undefined) ?? [];
    return dates.join(", ");
  }
  if (kind === "range") {
    return `${pattern.from ?? "?"} → ${pattern.to ?? "?"}`;
  }
  if (kind === "recurring") return `every ${String(pattern.weekday ?? "?")}`;
  return kind;
}

export async function loadAvailabilityContext(token: string): Promise<AvailabilityLoad> {
  const v = await verifySelfServiceToken(token, "availability_set");
  if (!v.ok) return v;

  const admin = createAdminClient();
  const [{ data: member }, { data: rows }] = await Promise.all([
    admin.from("member").select("display_name, language").eq("id", v.claims.member_id).maybeSingle(),
    admin
      .from("availability")
      .select("id, kind, pattern, reason")
      .eq("member_id", v.claims.member_id)
      .order("created_at", { ascending: false }),
  ]);
  if (!member) return { ok: false, error: "not_found" };

  const blockouts: Blockout[] = ((rows ?? []) as { id: string; kind: string; pattern: Record<string, unknown>; reason: string | null }[]).map(
    (r) => ({ id: r.id, label: patternLabel(r.kind, r.pattern), reason: r.reason }),
  );

  const memberLang = (member as { language?: string }).language;
  const locale: Locale = isLocale(memberLang) ? memberLang : DEFAULT_LOCALE;

  return { ok: true, memberName: (member.display_name as string) ?? "there", blockouts, locale };
}

export type BlockoutResult = { ok: boolean; error?: string };

/** Add a blockout: a single date (from only) or a range (from + to). */
export async function addBlockout(token: string, _prev: BlockoutResult, formData: FormData): Promise<BlockoutResult> {
  const v = await verifySelfServiceToken(token, "availability_set");
  if (!v.ok) return { ok: false, error: v.error };

  const from = String(formData.get("from") ?? "").trim();
  const to = String(formData.get("to") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return { ok: false, error: "Pick a start date." };
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { ok: false, error: "Invalid end date." };
  if (to && to < from) return { ok: false, error: "End date is before the start." };

  const kind = to && to !== from ? "range" : "specific";
  const pattern = kind === "range" ? { from, to } : { dates: [from] };

  const admin = createAdminClient();
  const { error } = await admin.from("availability").insert({
    member_id: v.claims.member_id,
    kind,
    pattern,
    reason,
    reason_visibility: "planner",
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/schedule");
  return { ok: true };
}

export async function removeBlockout(token: string, availabilityId: string): Promise<void> {
  const v = await verifySelfServiceToken(token, "availability_set");
  if (!v.ok) return;
  const admin = createAdminClient();
  // Claim-scoped: only the token-owner's own rows can be removed.
  await admin.from("availability").delete().eq("id", availabilityId).eq("member_id", v.claims.member_id);
  revalidatePath("/schedule");
}
