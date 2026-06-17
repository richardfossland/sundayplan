/**
 * Pastor's-chat data layer — assembles the church-scoped context the planning
 * agent's tools run against, and enforces the AI-consent flag + per-church AI
 * quota. EVERY read here runs under the planner's RLS (cookie-bound server
 * client), so the agent can only ever see the planner's own church — the model
 * never touches the database directly, it only receives this pre-loaded,
 * scoped context.
 *
 * The agent (packages/sdk/src/agent.ts) is the AI seam; this module is the
 * server-only glue that (a) gates access, (b) loads context, and (c) persists
 * the quota counter. It never applies the agent's proposed diff itself — that
 * stays an explicit planner action (schedule actions), so the accept-before-
 * write contract holds.
 */
import "server-only";
import {
  buildAutoFillSlots,
} from "@/lib/data/autofill";
import { getSchedule } from "@/lib/data/schedule";
import { getServeRows, getCoverageRows } from "@/lib/data/reports";
import { getCurrentChurchId } from "@/lib/data/church";
import { createClient } from "@/lib/supabase/server";
import {
  checkAiQuota,
  type AgentContext,
  type AiQuotaDecision,
} from "@sundayplan/sdk";

/** Why the agent is unavailable, when it is. Drives the panel's explainer copy. */
export type AgentGateReason =
  | "no_church"
  | "no_consent"
  | "quota_exhausted"
  | "no_api_key";

export type AgentGate =
  | { ok: true; churchId: string }
  | { ok: false; reason: AgentGateReason; detail?: string };

/**
 * Resolve whether the planning agent may run for the current church, BEFORE any
 * model call. Order matters: church → consent → API key → quota. The route
 * checks `ok` and either runs the agent or returns the reason for the panel to
 * explain. `no_api_key` is the keyless tier — the deterministic buttons stay
 * fully usable; only the chat is off.
 */
export async function checkAgentGate(hasApiKey: boolean): Promise<AgentGate> {
  const churchId = await getCurrentChurchId();
  if (!churchId) return { ok: false, reason: "no_church" };

  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("church_settings")
    .select("ai_consent, ai_agent_turns_used, ai_quota_used_at_reset")
    .eq("church_id", churchId)
    .maybeSingle();

  if (!settings?.ai_consent) return { ok: false, reason: "no_consent" };
  if (!hasApiKey) return { ok: false, reason: "no_api_key" };

  // Per-church monthly AI quota (mirrors SMS). The route persists the new
  // counter only after a successful run, so a failed/aborted turn isn't charged.
  const { data: church } = await supabase
    .from("church")
    .select("plan_tier")
    .eq("id", churchId)
    .maybeSingle();
  const decision = aiQuotaDecisionFor(settings, church?.plan_tier ?? "free");
  if (!decision.allowed) {
    return { ok: false, reason: "quota_exhausted", detail: decision.reason };
  }
  return { ok: true, churchId };
}

interface AiQuotaSettingsRow {
  ai_agent_turns_used?: number | null;
  ai_quota_used_at_reset?: string | null;
}

/** Pure decision wrapper so callers and tests share one quota source of truth. */
export function aiQuotaDecisionFor(
  settings: AiQuotaSettingsRow,
  tier: string | null | undefined,
  now: Date = new Date(),
): AiQuotaDecision {
  return checkAiQuota({
    tier,
    used: settings.ai_agent_turns_used ?? 0,
    // Column defaults to now() at migration; fall back to epoch so a missing
    // value reads as "forever ago" → rolls over → starts fresh (never blocks).
    usedAtReset: settings.ai_quota_used_at_reset ?? "1970-01-01T00:00:00Z",
    now,
  });
}

/**
 * Persist one consumed AI turn against the church's monthly quota. Called by the
 * route ONLY after a successful agent run. Honours the implicit month rollover
 * the decision computed. Runs under planner RLS (church_settings write policy).
 */
export async function consumeAiTurn(churchId: string): Promise<void> {
  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("church_settings")
    .select("ai_agent_turns_used, ai_quota_used_at_reset")
    .eq("church_id", churchId)
    .maybeSingle();
  const { data: church } = await supabase
    .from("church")
    .select("plan_tier")
    .eq("id", churchId)
    .maybeSingle();

  const decision = aiQuotaDecisionFor(settings ?? {}, church?.plan_tier ?? "free");
  await supabase
    .from("church_settings")
    .update({
      ai_agent_turns_used: decision.nextUsed,
      ...(decision.shouldReset ? { ai_quota_used_at_reset: new Date().toISOString() } : {}),
    })
    .eq("church_id", churchId);
}

/**
 * Load the full {@link AgentContext} for the current church under RLS. Composes
 * the same deterministic builders the schedule page + auto-fill button already
 * use, so the agent's tools operate on exactly the data the planner sees.
 */
export async function loadAgentContext(now: Date = new Date()): Promise<AgentContext> {
  // Reporting window: the surrounding month (coverage/balance tools).
  const from = startOfMonth(now);
  const to = endOfMonth(now);

  const [{ slots, minRestDays }, schedule, serveRows, coverageRows] = await Promise.all([
    buildAutoFillSlots(now, { withWindowPriors: true }),
    getSchedule(),
    getServeRows(from, to),
    getCoverageRows(from, to),
  ]);

  return {
    slots,
    minRestDays,
    conflictContext: schedule.conflictContext,
    serveRows,
    coverageRows,
    window: { from, to },
    memberNames: schedule.memberNames,
    roleNames: schedule.roleNames,
    serviceLabels: schedule.serviceLabels,
    // swapInputs / setlistInputs are wired in a follow-up; the agent reports a
    // clean "unknown id" error if asked for them before then (handled in dispatch).
  };
}

function startOfMonth(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
function endOfMonth(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}
