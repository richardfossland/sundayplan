/**
 * Pastor's-chat route handler — the server seam for the conversational planning
 * agent. Runs server-side only (the Anthropic key never reaches the browser),
 * loads church-scoped context under RLS, runs the tool-use agent, and returns
 * the natural-language reply plus a REVIEWABLE diff the planner accepts before
 * any write. This route performs no DB writes to the schedule — it only records
 * one consumed AI turn against the church's quota on success.
 *
 * Keyless / gated tiers degrade gracefully: with no API key, no AI consent, or
 * an exhausted quota the route returns `{ available: false, reason }` with HTTP
 * 200, and the panel explains the situation. The deterministic auto-fill buttons
 * are entirely unaffected — they don't go through here.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getPlannerAgent, type AnthropicMessage } from "@sundayplan/sdk";
import { checkAgentGate, loadAgentContext, consumeAiTurn } from "@/lib/data/planner-agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-only AI env (never bundled to the client). */
function agentEnv() {
  return {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    SUNDAYPLAN_AGENT_MODEL: process.env.SUNDAYPLAN_AGENT_MODEL,
  };
}

interface ChatRequestBody {
  message?: unknown;
  history?: unknown;
}

/** Coerce untrusted history into the Anthropic message shape we re-send. */
function sanitiseHistory(raw: unknown): AnthropicMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is { role: string; content: unknown } => !!m && typeof m === "object" && "role" in m)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

export async function POST(req: NextRequest) {
  const agent = getPlannerAgent(agentEnv());
  const hasApiKey = agent !== null;

  // Gate FIRST — cheap checks (consent/quota) before any model call.
  const gate = await checkAgentGate(hasApiKey);
  if (!gate.ok) {
    return NextResponse.json({ available: false, reason: gate.reason, detail: gate.detail });
  }
  // gate.ok implies a key is present, so the agent is non-null here.
  if (!agent) {
    return NextResponse.json({ available: false, reason: "no_api_key" });
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "empty_message" }, { status: 400 });
  }

  const history = sanitiseHistory(body.history);
  const ctx = await loadAgentContext();

  try {
    const result = await agent.run(message, history, ctx);
    // Charge the church one AI turn only on a successful run.
    await consumeAiTurn(gate.churchId);
    return NextResponse.json({
      available: true,
      reply: result.reply,
      diff: result.diff,
      toolsUsed: result.toolsUsed,
    });
  } catch {
    // Model/transport failure: do NOT charge a turn; tell the panel to fall back.
    return NextResponse.json({ available: false, reason: "no_api_key", detail: "agent_error" }, { status: 502 });
  }
}
