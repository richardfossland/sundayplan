/**
 * Pastor's chat — a Claude tool-use planning agent (the conversational rota
 * assistant) that sits BESIDE rationale-refiner.ts and reuses its discipline.
 *
 * Design principle (the whole point of the feature): the model NEVER writes to
 * the database and NEVER picks people on its own. Its only powers are to CALL
 * the existing deterministic engines as tools and to narrate the result. The
 * pure engines decide; the model proposes. A hallucinating model therefore
 * cannot move a score, double-book a volunteer, or fill an unavailable person —
 * the worst it can do is call a tool with bad arguments, which the schema
 * validation and the engines themselves reject.
 *
 *   • TOOLS are the existing engines: autofill / balancedAutofill, conflicts,
 *     coverage, swap (eligibleReplacements), setlist-ai (proposeSetlist). They
 *     run server-side against church-scoped context loaded under RLS. The model
 *     receives only the engine OUTPUT, never raw DB access.
 *   • Every change the agent proposes is returned as a reviewable DIFF
 *     ({@link AssignmentDiff}) that the planner accepts before any write. The
 *     agent itself performs zero writes.
 *   • Keyless fallback, identical to the rest of the AI seams in this package:
 *     `getPlannerAgent(env)` returns `null` when there is no API key. Callers
 *     fall back to the deterministic buttons; the panel explains AI is off.
 *   • Prompt caching: the (large, stable) system prompt + tool definitions are
 *     marked with `cache_control` so a multi-turn conversation only pays for the
 *     small per-turn delta.
 *
 * The tool DISPATCH and the DIFF computation are pure functions, unit-tested
 * with canned fixtures (no network, no key). That is where the real coverage is.
 */

import { autoFill, type AutoFillResult, type AutoFillSlot, type ProposedAssignment } from "./autofill";
import { balancedAutoFill, type BalancedAutoFillResult } from "./balancedAutofill";
import { detectConflicts, type Conflict, type ConflictContext } from "./conflicts";
import {
  buildServiceCoverage,
  buildVolunteerBalance,
  type CoverageRow,
  type ServeRow,
  type ServiceCoverageReport,
  type VolunteerBalanceReport,
} from "./coverage";
import { eligibleReplacements, type EligibleReplacementsInput, type RankedReplacement } from "./swap";
import { proposeSetlist, type SetlistRequest, type SetlistSuggestion } from "./setlist-ai";

// ── Env + key seam (mirrors getRationaleRefiner) ─────────────────────────────

/** The minimal env we read — `process.env`-shaped, injectable for tests. */
export interface PlannerAgentEnv {
  ANTHROPIC_API_KEY?: string;
  /** Override the model; defaults to the suite's current Opus. */
  SUNDAYPLAN_AGENT_MODEL?: string;
}

/** Default model — the current Opus, matching the suite's AI seams. */
export const DEFAULT_AGENT_MODEL = "claude-opus-4-8";
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
/** Bound the agentic loop so a misbehaving model can never spin forever. */
export const MAX_AGENT_TURNS = 6;

// ── The church-scoped context the engines run against ────────────────────────
//
// This is loaded ONCE per request by the server (under RLS) and handed to the
// dispatcher. The model never sees the raw rows directly except via summaries
// the dispatcher returns; it can only act on them by naming a tool.

/** A slot the auto-fill tools can fill, keyed for diffing back to the schedule. */
export interface AgentContext {
  /** Open (service, role) slots with ranked candidates — drives auto-fill. */
  slots: AutoFillSlot[];
  /** Hard rest window in days (0 = off) — threaded to the fill engines. */
  minRestDays: number;
  /** Full conflict-engine context for the current (live) schedule. */
  conflictContext: ConflictContext;
  /** Per-volunteer serve history — drives the coverage/balance tool. */
  serveRows: ServeRow[];
  /** Per-(service, role) coverage rows — drives the coverage tool. */
  coverageRows: CoverageRow[];
  /** Reporting window for the coverage tool (ISO dates). */
  window: { from: string; to: string };
  /** Swap inputs keyed by an opaque id the planner referenced (optional). */
  swapInputs?: Record<string, EligibleReplacementsInput>;
  /** Setlist inputs keyed by service id (optional). */
  setlistInputs?: Record<string, SetlistRequest>;
  /** Human-readable display names, so summaries read naturally. */
  memberNames?: Record<string, string>;
  roleNames?: Record<string, string>;
  serviceLabels?: Record<string, string>;
}

// ── Tool catalogue ───────────────────────────────────────────────────────────
//
// Each entry mirrors one deterministic engine. The `input_schema` is the strict
// Anthropic tool schema the model must satisfy; the dispatcher validates inputs
// again before running, so a malformed tool call degrades to an error result
// (which the model can read and retry) rather than crashing or writing garbage.

export type AgentToolName =
  | "autofill_open_slots"
  | "balanced_autofill"
  | "check_conflicts"
  | "coverage_report"
  | "suggest_replacements"
  | "suggest_setlist";

/** Anthropic tool definition (the subset we emit). */
export interface ToolDef {
  name: AgentToolName;
  description: string;
  input_schema: Record<string, unknown>;
}

const NO_ARG_SCHEMA = { type: "object", properties: {}, additionalProperties: false } as const;

/**
 * The tool definitions sent to the model. Norwegian-leaning descriptions so the
 * model reasons in the planner's language, but tool NAMES stay ASCII for the API.
 * Stable + cacheable across turns.
 */
export const AGENT_TOOLS: ToolDef[] = [
  {
    name: "autofill_open_slots",
    description:
      "Foreslå frivillige til alle åpne roller med den deterministiske autofyll-motoren " +
      "(grådig, beste match per rolle). Returnerer forslag og rangering. Skriver ingenting.",
    input_schema: NO_ARG_SCHEMA,
  },
  {
    name: "balanced_autofill",
    description:
      "Som autofyll, men jevner i tillegg ut belastningen rettferdig over hele perioden " +
      "(reduserer utbrenthet) uten å bryte harde regler eller senke kvaliteten vesentlig. " +
      "Bruk denne når brukeren ber om en rettferdig fordeling. Skriver ingenting.",
    input_schema: NO_ARG_SCHEMA,
  },
  {
    name: "check_conflicts",
    description:
      "Kjør konfliktmotoren over den nåværende planen og list opp harde og myke konflikter " +
      "(dobbeltbooking, utilgjengelig, for mange uker på rad osv.). Skriver ingenting.",
    input_schema: NO_ARG_SCHEMA,
  },
  {
    name: "coverage_report",
    description:
      "Oppsummer dekning (åpne/manglende roller per gudstjeneste) og frivillig-belastning " +
      "(hvem bærer mest) for perioden. Bruk for spørsmål om hull eller fordeling. Skriver ingenting.",
    input_schema: NO_ARG_SCHEMA,
  },
  {
    name: "suggest_replacements",
    description:
      "Foreslå rangerte erstattere for en frivillig som må byttes ut i en rolle. " +
      "Krever en swap-id brukeren har referert til. Skriver ingenting.",
    input_schema: {
      type: "object",
      properties: {
        swap_id: { type: "string", description: "Id-en på byttet det gjelder." },
      },
      required: ["swap_id"],
      additionalProperties: false,
    },
  },
  {
    name: "suggest_setlist",
    description:
      "Foreslå sanger til en gudstjeneste etter tema og rotasjon (Asaph-stil). " +
      "Krever en service-id brukeren har referert til. Skriver ingenting.",
    input_schema: {
      type: "object",
      properties: {
        service_id: { type: "string", description: "Id-en på gudstjenesten." },
      },
      required: ["service_id"],
      additionalProperties: false,
    },
  },
];

// ── Tool results (engine output, normalised for the model + the diff) ─────────

export interface AutofillToolResult {
  kind: "autofill";
  balanced: boolean;
  result: AutoFillResult | BalancedAutoFillResult;
  /** The reviewable diff the planner accepts before any write. */
  diff: AssignmentDiff;
}
export interface ConflictsToolResult {
  kind: "conflicts";
  conflicts: Conflict[];
}
export interface CoverageToolResult {
  kind: "coverage";
  service: ServiceCoverageReport;
  balance: VolunteerBalanceReport;
}
export interface ReplacementsToolResult {
  kind: "replacements";
  swap_id: string;
  ranked: RankedReplacement[];
}
export interface SetlistToolResult {
  kind: "setlist";
  service_id: string;
  suggestions: SetlistSuggestion[];
}
export interface ToolErrorResult {
  kind: "error";
  /** Machine-readable so the model can decide whether to retry differently. */
  error: string;
}

export type AgentToolResult =
  | AutofillToolResult
  | ConflictsToolResult
  | CoverageToolResult
  | ReplacementsToolResult
  | SetlistToolResult
  | ToolErrorResult;

// ── The reviewable diff (the accept-before-write contract) ────────────────────

/** One proposed assignment, denormalised with display names for review. */
export interface DiffAddition extends ProposedAssignment {
  member_name?: string;
  role_name?: string;
  service_label?: string;
}

export interface DiffUnfilled {
  service_id: string;
  role_id: string;
  needed: number;
  filled: number;
  role_name?: string;
  service_label?: string;
}

/**
 * A reviewable change set. The agent never writes; the planner accepts this
 * diff and the SERVER applies it (re-running the engine, never trusting the
 * model's numbers). `additions` are new pending proposals to lay down.
 */
export interface AssignmentDiff {
  additions: DiffAddition[];
  unfilled: DiffUnfilled[];
  /** Whether the fairness-balancing pass produced this diff. */
  balanced: boolean;
  /** Total relevance score of the additions (engine-computed, for display). */
  totalScore: number;
}

/**
 * Compute the reviewable diff from an engine result. Pure + deterministic. This
 * is the boundary the planner reviews: only `additions` ever become writes, and
 * each carries the engine's own score (the model cannot fabricate one).
 */
export function computeAssignmentDiff(
  result: AutoFillResult,
  ctx: Pick<AgentContext, "memberNames" | "roleNames" | "serviceLabels">,
  balanced: boolean,
): AssignmentDiff {
  const additions: DiffAddition[] = result.assignments.map((a) => ({
    ...a,
    member_name: ctx.memberNames?.[a.member_id],
    role_name: ctx.roleNames?.[a.role_id],
    service_label: ctx.serviceLabels?.[a.service_id],
  }));
  const unfilled: DiffUnfilled[] = result.unfilled.map((u) => ({
    ...u,
    role_name: ctx.roleNames?.[u.role_id],
    service_label: ctx.serviceLabels?.[u.service_id],
  }));
  const totalScore = round1(additions.reduce((s, a) => s + a.score.total, 0));
  return { additions, unfilled, balanced, totalScore };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Pure tool dispatch (the safety boundary) ──────────────────────────────────

/** Raw tool input as received from the model (untrusted). */
export type ToolInput = Record<string, unknown>;

/**
 * Run one tool against the church-scoped context. PURE w.r.t. the context it is
 * given (the engines are pure; this only routes + validates). Never throws on a
 * malformed model input — it returns a `{ kind: "error" }` result the model can
 * read and recover from. This is the chokepoint that makes the agent safe:
 * every path here runs a deterministic engine, never a DB write.
 */
export function dispatchTool(
  name: string,
  input: ToolInput,
  ctx: AgentContext,
): AgentToolResult {
  switch (name) {
    case "autofill_open_slots": {
      const result = autoFill(ctx.slots, { minRestDays: ctx.minRestDays });
      return { kind: "autofill", balanced: false, result, diff: computeAssignmentDiff(result, ctx, false) };
    }
    case "balanced_autofill": {
      const result = balancedAutoFill(ctx.slots, { minRestDays: ctx.minRestDays });
      return { kind: "autofill", balanced: true, result, diff: computeAssignmentDiff(result, ctx, true) };
    }
    case "check_conflicts": {
      return { kind: "conflicts", conflicts: detectConflicts(ctx.conflictContext) };
    }
    case "coverage_report": {
      return {
        kind: "coverage",
        service: buildServiceCoverage(ctx.coverageRows, ctx.window.from, ctx.window.to),
        balance: buildVolunteerBalance(ctx.serveRows, ctx.window.from, ctx.window.to),
      };
    }
    case "suggest_replacements": {
      const swapId = typeof input.swap_id === "string" ? input.swap_id : "";
      const swapInput = ctx.swapInputs?.[swapId];
      if (!swapInput) {
        return { kind: "error", error: `unknown_swap_id:${swapId || "(missing)"}` };
      }
      return { kind: "replacements", swap_id: swapId, ranked: eligibleReplacements(swapInput) };
    }
    case "suggest_setlist": {
      const serviceId = typeof input.service_id === "string" ? input.service_id : "";
      const setlistInput = ctx.setlistInputs?.[serviceId];
      if (!setlistInput) {
        return { kind: "error", error: `unknown_service_id:${serviceId || "(missing)"}` };
      }
      return { kind: "setlist", service_id: serviceId, suggestions: proposeSetlist(setlistInput) };
    }
    default:
      return { kind: "error", error: `unknown_tool:${name}` };
  }
}

/**
 * Serialise a tool result into the compact JSON the model reads back. We strip
 * the heavy `diff`/internal score breakdowns down to what the model needs to
 * narrate — the planner reviews the full diff client-side, the model only needs
 * the gist. Pure + deterministic.
 */
export function summariseToolResult(r: AgentToolResult): string {
  switch (r.kind) {
    case "autofill": {
      const d = r.diff;
      const fairness =
        "fairness" in r.result
          ? { gapBefore: r.result.fairness.gapBefore, gapAfter: r.result.fairness.gapAfter, swaps: r.result.fairness.swaps.length }
          : undefined;
      return JSON.stringify({
        balanced: r.balanced,
        proposed: d.additions.map((a) => ({
          service: a.service_label ?? a.service_id,
          role: a.role_name ?? a.role_id,
          member: a.member_name ?? a.member_id,
          score: a.score.total,
        })),
        unfilled: d.unfilled.map((u) => ({
          service: u.service_label ?? u.service_id,
          role: u.role_name ?? u.role_id,
          needed: u.needed,
          filled: u.filled,
        })),
        totalScore: d.totalScore,
        fairness,
      });
    }
    case "conflicts":
      return JSON.stringify({
        conflicts: r.conflicts.map((c) => ({ rule: c.rule, severity: c.severity, message: c.message })),
      });
    case "coverage":
      return JSON.stringify({
        services: r.service.lines.map((l) => ({
          service: l.name,
          filled: l.filledSlots,
          required: l.requiredSlots,
          gaps: l.gaps.map((g) => ({ role: g.role, missing: g.missing })),
        })),
        balance: r.balance.lines.map((l) => ({ member: l.name, serves: l.serves, delta: l.delta })),
      });
    case "replacements":
      return JSON.stringify({
        swap_id: r.swap_id,
        ranked: r.ranked.map((x) => ({ member: x.member_id, score: x.score })),
      });
    case "setlist":
      return JSON.stringify({
        service_id: r.service_id,
        songs: r.suggestions.map((s) => ({ title: s.title, score: s.score, reasons: s.reasons })),
      });
    case "error":
      return JSON.stringify({ error: r.error });
  }
}

// ── The Anthropic Messages-API request builder (pure) ─────────────────────────

/** A turn in the conversation, in Anthropic content-block shape. */
export interface AnthropicMessage {
  role: "user" | "assistant";
  content: unknown;
}

/** Norwegian-first system prompt. Stable + cacheable. */
export const AGENT_SYSTEM_PROMPT = [
  "Du er en hjelpsom planleggingsassistent for en menighet som setter opp frivillige til",
  "gudstjenester. Brukeren er en travel frivillig eller deltidsansatt — svar varmt, kort og",
  "tydelig på norsk (eller brukerens språk om de skriver på et annet).",
  "",
  "VIKTIG om hvordan du jobber:",
  "• Du foreslår ALDRI navn på egen hånd og skriver ALDRI til databasen. Du bruker kun",
  "  verktøyene, som er menighetens egne deterministiske motorer. Verktøyene bestemmer hvem",
  "  som passer; du forklarer resultatet.",
  "• Når brukeren vil fylle åpne roller, kall autofill_open_slots (eller balanced_autofill",
  "  hvis de vil ha rettferdig fordeling). Forslagene vises som et utkast planleggeren må",
  "  godkjenne før noe lagres — si tydelig at ingenting er lagret ennå.",
  "• For spørsmål om konflikter, dekning, bytter eller sanger: bruk riktig verktøy og",
  "  oppsummer resultatet. Ikke dikt opp tall — bruk kun det verktøyene returnerer.",
  "• Hvis et verktøy returnerer en feil (f.eks. ukjent id), forklar pent hva som mangler.",
  "",
  "Hold tonen menighetsvennlig og ydmyk. Du er et hjelpemiddel, ikke en autoritet.",
].join("\n");

/**
 * Build the Anthropic Messages-API request body for one turn. PURE — no
 * network. The system prompt + tools carry `cache_control` so a multi-turn
 * chat only pays for the small per-turn delta. Tested with fixtures.
 */
export function buildAgentRequest(
  messages: AnthropicMessage[],
  model: string,
): Record<string, unknown> {
  return {
    model,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: AGENT_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: AGENT_TOOLS.map((t, i) =>
      // Cache the (stable) tool block on the last tool so the whole prefix caches.
      i === AGENT_TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t,
    ),
    messages,
  };
}

// ── Response parsing (pure) ───────────────────────────────────────────────────

/** A tool-use block the model emitted. */
export interface ParsedToolUse {
  id: string;
  name: string;
  input: ToolInput;
}

export interface ParsedAgentReply {
  /** Concatenated assistant text (may be empty when it only called tools). */
  text: string;
  /** Tool calls the model requested this turn. */
  toolUses: ParsedToolUse[];
  /** The raw assistant content blocks, to echo back into the next turn. */
  rawContent: unknown;
  /** Anthropic stop reason ("tool_use", "end_turn", …). */
  stopReason: string | null;
}

/**
 * Parse an Anthropic Messages-API response into text + tool calls. PURE,
 * defensive: tolerates missing fields and never throws on a well-formed-but-
 * empty reply. Tested with canned fixtures.
 */
export function parseAgentReply(json: unknown): ParsedAgentReply {
  const obj = (json ?? {}) as {
    content?: Array<Record<string, unknown>>;
    stop_reason?: string | null;
  };
  const content = Array.isArray(obj.content) ? obj.content : [];
  let text = "";
  const toolUses: ParsedToolUse[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      text += (text ? "\n" : "") + block.text;
    } else if (block.type === "tool_use") {
      toolUses.push({
        id: typeof block.id === "string" ? block.id : "",
        name: typeof block.name === "string" ? block.name : "",
        input: (block.input ?? {}) as ToolInput,
      });
    }
  }
  return { text, toolUses, rawContent: content, stopReason: obj.stop_reason ?? null };
}

/**
 * Build the `tool_result` user turn that feeds engine output back to the model.
 * PURE. Each block references the originating `tool_use_id`.
 */
export function buildToolResultMessage(
  results: Array<{ tool_use_id: string; content: string; is_error?: boolean }>,
): AnthropicMessage {
  return {
    role: "user",
    content: results.map((r) => ({
      type: "tool_result",
      tool_use_id: r.tool_use_id,
      content: r.content,
      ...(r.is_error ? { is_error: true } : {}),
    })),
  };
}

// ── The agent (the only impure part — gated behind a key) ─────────────────────

/** What a completed agent run hands back to the route. */
export interface AgentRunResult {
  /** The final natural-language reply for the planner. */
  reply: string;
  /**
   * The most recent reviewable diff the agent produced via an auto-fill tool,
   * or null if it never proposed assignments this run. The planner accepts THIS
   * before any write happens.
   */
  diff: AssignmentDiff | null;
  /** Every tool the agent invoked this run, for transparency/audit. */
  toolsUsed: AgentToolName[];
}

export interface PlannerAgent {
  /**
   * Run the agentic loop for one planner turn. `history` is the prior
   * conversation in Anthropic message shape; `userText` is the new message.
   * Bounded by {@link MAX_AGENT_TURNS}.
   */
  run(userText: string, history: AnthropicMessage[], ctx: AgentContext): Promise<AgentRunResult>;
}

/**
 * Construct a Claude-backed planner agent, or `null` when no API key is present
 * (the offline tier). Mirrors {@link getRationaleRefiner}: callers that get
 * `null` keep using the deterministic buttons and tell the user AI is off.
 */
export function getPlannerAgent(env: PlannerAgentEnv | undefined): PlannerAgent | null {
  const apiKey = env?.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env?.SUNDAYPLAN_AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL;
  return new ClaudePlannerAgent(apiKey, model);
}

/** Pluggable transport so the loop can be unit-tested with a fake (no network). */
export type AgentTransport = (body: Record<string, unknown>) => Promise<unknown>;

class ClaudePlannerAgent implements PlannerAgent {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    /** Injectable for tests; defaults to a real fetch to the Messages API. */
    private readonly transport?: AgentTransport,
  ) {}

  async run(userText: string, history: AnthropicMessage[], ctx: AgentContext): Promise<AgentRunResult> {
    return runAgentLoop(
      this.transport ?? ((body) => this.fetchMessages(body)),
      this.model,
      userText,
      history,
      ctx,
    );
  }

  private async fetchMessages(body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": API_VERSION,
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`planner-agent: ${res.status}`);
    return res.json();
  }
}

/**
 * The agentic loop, factored out so tests drive it with a fake transport (no
 * network, no key). The transport receives the request body and returns a raw
 * Messages-API response object. Bounded by {@link MAX_AGENT_TURNS}; on each
 * `tool_use` stop it dispatches every requested tool through {@link dispatchTool}
 * (the safety boundary) and feeds the results back. Exposed for testing.
 */
export async function runAgentLoop(
  transport: AgentTransport,
  model: string,
  userText: string,
  history: AnthropicMessage[],
  ctx: AgentContext,
): Promise<AgentRunResult> {
  const messages: AnthropicMessage[] = [...history, { role: "user", content: userText }];
  const toolsUsed: AgentToolName[] = [];
  let diff: AssignmentDiff | null = null;
  let reply = "";

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const body = buildAgentRequest(messages, model);
    const json = await transport(body);
    const parsed = parseAgentReply(json);
    if (parsed.text) reply = parsed.text;
    // Echo the assistant turn back so the conversation stays coherent.
    messages.push({ role: "assistant", content: parsed.rawContent });

    if (parsed.toolUses.length === 0 || parsed.stopReason !== "tool_use") {
      break; // model is done talking
    }

    const results = parsed.toolUses.map((tu) => {
      const out = dispatchTool(tu.name, tu.input, ctx);
      if (out.kind === "autofill") diff = out.diff; // latest proposed change set
      if (isAgentToolName(tu.name)) toolsUsed.push(tu.name);
      return {
        tool_use_id: tu.id,
        content: summariseToolResult(out),
        is_error: out.kind === "error",
      };
    });
    messages.push(buildToolResultMessage(results));
  }

  return { reply, diff, toolsUsed };
}

function isAgentToolName(name: string): name is AgentToolName {
  return AGENT_TOOLS.some((t) => t.name === name);
}
