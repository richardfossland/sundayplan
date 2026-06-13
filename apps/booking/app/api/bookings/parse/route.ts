/**
 * POST /api/bookings/parse — natural-language booking (Phase 4, feature 1).
 *
 * Takes a Norwegian free-text prompt and returns a STRUCTURED proposal that
 * pre-fills the create-booking form. It NEVER books: the model only proposes;
 * the human confirms before POST /api/bookings, and the DB exclusion constraint
 * + RPC remain the guard.
 *
 * Gating (all server-side, never trusting the body for church/identity):
 *   • requireMember — any church member may use it.
 *   • ai_consent — the church must have opted into cloud AI (church_settings).
 *   • AI quota — a per-church monthly parse allowance (checkAiQuota).
 *   • ANTHROPIC_API_KEY — without it `getBookingParser` returns null.
 *
 * KEYLESS FALLBACK: when no key OR no consent, this returns 200 with
 * `{ available: false, reason }` so the client hides the prompt bar / shows
 * "AI ikke tilgjengelig" and the manual form keeps working. Quota-exhausted
 * returns 429. The fuzzy match + Norwegian date interpreter + normalizer that
 * shape the proposal are pure (lib/nl-booking.ts) and unit-tested with canned
 * fixtures — only the extraction step needs a key.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireMember } from "@/lib/auth-guard";
import {
  getAiConsent,
  getAiQuotaRow,
  bumpAiQuota,
  listResources,
  listEventTypes,
} from "@/lib/data/booking";
import { getBookingParser } from "@/lib/nl-llm";
import { draftToProposal } from "@/lib/nl-booking";
import { checkAiQuota } from "@/lib/ai-quota";

export const dynamic = "force-dynamic";

const MAX_PROMPT = 600;

export async function POST(req: NextRequest): Promise<Response> {
  const guard = await requireMember();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { ctx } = guard;

  // The parser only exists when a key is configured (keyless fallback otherwise).
  const parser = getBookingParser(process.env);
  if (!parser) {
    return NextResponse.json({ available: false, reason: "no_key" }, { status: 200 });
  }

  // Church-level opt-in (GDPR posture: cloud AI strictly opt-in).
  const consent = await getAiConsent(ctx.churchId);
  if (!consent) {
    return NextResponse.json({ available: false, reason: "no_consent" }, { status: 200 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "prompt_required" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json({ error: "prompt_too_long" }, { status: 400 });
  }

  // Per-church monthly AI quota.
  const q = await getAiQuotaRow(ctx.churchId);
  const decision = checkAiQuota({
    tier: q.plan_tier,
    used: q.ai_quota_used,
    usedAtReset: q.ai_quota_used_at_reset,
  });
  if (!decision.allowed) {
    return NextResponse.json(
      { available: true, error: "quota_exceeded", reason: decision.reason },
      { status: 429 },
    );
  }

  // Context the model maps onto (REAL names only — no hallucinated resources).
  const [resources, eventTypes] = await Promise.all([
    listResources(ctx.churchId),
    listEventTypes(ctx.churchId),
  ]);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;

  let proposal;
  try {
    const draft = await parser.parse(prompt, {
      resourceNames: resources.map((r) => r.name),
      eventTypeNames: eventTypes.map((e) => e.name),
      today,
    });
    proposal = draftToProposal(draft, {
      resources: resources.map((r) => ({ id: r.id, name: r.name })),
      eventTypes: eventTypes.map((e) => ({
        id: e.id,
        name: e.name,
        default_duration_min: e.default_duration_min,
      })),
      now,
    });
  } catch (err) {
    // A model/transport failure must NOT crash the surface — fall back to manual.
    // eslint-disable-next-line no-console
    console.error("[booking:parse] LLM call failed", err);
    return NextResponse.json({ available: true, error: "parse_failed" }, { status: 502 });
  }

  // Persist the quota counter only on a successful parse (best-effort).
  void bumpAiQuota(ctx.churchId, decision.nextUsed, decision.shouldReset).catch((e) => {
    // eslint-disable-next-line no-console
    console.error("[booking:parse] quota bump failed", e);
  });

  return NextResponse.json({ available: true, proposal }, { status: 200 });
}
