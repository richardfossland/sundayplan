/**
 * GDPR data export — `GET /api/export` downloads the signed-in planner's
 * church data as one JSON bundle.
 *
 * Runs entirely under the user's RLS-scoped client: the bundle contains
 * exactly what the planner can already see in the app, never more — so no
 * admin client, no separate authorization model to keep in sync. Tables are
 * the personal-data-bearing + planning core; internal plumbing (magic-link
 * hashes, invite tokens) is deliberately excluded.
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/data/church";

export const dynamic = "force-dynamic";

const CHURCH_SCOPED_TABLES = [
  "church_settings",
  "member",
  "team",
  "service",
  "assignment",
  "swap_request",
  "message_template",
  "message",
  "message_delivery",
  "app_grant",
] as const;

export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const churchId = await getCurrentChurchId();
  if (!churchId) {
    return Response.json({ error: "no_church" }, { status: 401 });
  }

  const { data: church } = await supabase
    .from("church")
    .select("*")
    .eq("id", churchId)
    .maybeSingle();

  const bundle: Record<string, unknown> = {
    format: "sundayplan-export",
    version: 1,
    exported_at: new Date().toISOString(),
    church,
  };

  for (const table of CHURCH_SCOPED_TABLES) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("church_id", churchId);
    bundle[table] = error ? { export_error: error.message } : (data ?? []);
  }

  // Roles hang off teams (no church_id column) — join through the team.
  const { data: roles } = await supabase
    .from("role")
    .select("*, team:team_id!inner(church_id)")
    .eq("team.church_id", churchId);
  bundle.role = roles ?? [];

  const slug =
    (church as { slug?: string } | null)?.slug ?? churchId.slice(0, 8);
  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="sundayplan-export-${slug}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
