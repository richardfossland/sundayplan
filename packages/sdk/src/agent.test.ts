import { describe, expect, it, vi } from "vitest";
import type { SkillLevel } from "@sundayplan/shared";
import {
  AGENT_TOOLS,
  AGENT_SYSTEM_PROMPT,
  DEFAULT_AGENT_MODEL,
  MAX_AGENT_TURNS,
  buildAgentRequest,
  buildToolResultMessage,
  computeAssignmentDiff,
  dispatchTool,
  getPlannerAgent,
  parseAgentReply,
  runAgentLoop,
  summariseToolResult,
  type AgentContext,
  type AnthropicMessage,
} from "./agent";
import type { AutoFillSlot } from "./autofill";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SVC = "svc-1";
const ROLE = "role-1";
const SERVICE_AT = new Date("2026-07-05T09:00:00Z");

function scoringInputs(memberId: string, skill: SkillLevel = "capable") {
  return {
    candidate: {
      member_id: memberId,
      skill_level: skill,
      accepted_recent_count: 0,
      days_since_last_assignment: null,
      days_since_last_assignment_same_role: null,
      target_serves_per_month: 2,
      availability: [],
      consecutive_weeks_served: 0,
      has_frequent_partner_on_service: false,
      has_trainer_paired: false,
    },
    slot: { service_starts_at: SERVICE_AT, role_skill_required: "capable" as SkillLevel },
  };
}

/** Two eligible candidates for one open slot. */
function slots(): AutoFillSlot[] {
  return [
    {
      service_id: SVC,
      role_id: ROLE,
      quantity: 1,
      candidates: [
        { member_id: "anna", joined_at: "2024-01-01", inputs: scoringInputs("anna", "lead") },
        { member_id: "bjorn", joined_at: "2024-02-01", inputs: scoringInputs("bjorn") },
      ],
    },
  ];
}

function context(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    slots: slots(),
    minRestDays: 0,
    conflictContext: {
      services: [{ id: SVC, starts_at: SERVICE_AT }],
      assignments: [],
      members: [
        { id: "anna", availability: [], max_assignments_per_month: 4 },
        { id: "bjorn", availability: [], max_assignments_per_month: 4 },
      ],
    },
    serveRows: [
      {
        memberId: "anna",
        name: "Anna",
        targetPerMonth: 2,
        serviceId: SVC,
        serviceDateLocal: "2026-07-05",
      },
    ],
    coverageRows: [
      {
        serviceId: SVC,
        serviceName: "Søndag 5. juli",
        serviceDateLocal: "2026-07-05",
        roleId: ROLE,
        roleName: "Lydtekniker",
        required: 2,
        filled: 1,
      },
    ],
    window: { from: "2026-07-01", to: "2026-07-31" },
    memberNames: { anna: "Anna", bjorn: "Bjørn" },
    roleNames: { [ROLE]: "Lydtekniker" },
    serviceLabels: { [SVC]: "Søndag 5. juli" },
    ...overrides,
  };
}

// ── Keyless fallback (mirrors getRationaleRefiner) ────────────────────────────

describe("getPlannerAgent — keyless fallback", () => {
  it("returns null without an API key (offline tier)", () => {
    expect(getPlannerAgent(undefined)).toBeNull();
    expect(getPlannerAgent({})).toBeNull();
    expect(getPlannerAgent({ ANTHROPIC_API_KEY: "   " })).toBeNull();
  });

  it("returns a usable agent when a key is present", () => {
    const a = getPlannerAgent({ ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(a).not.toBeNull();
    expect(typeof a!.run).toBe("function");
  });

  it("defaults to the current Opus model id", () => {
    expect(DEFAULT_AGENT_MODEL).toBe("claude-opus-4-8");
  });
});

// ── Pure tool dispatch (the safety boundary) ──────────────────────────────────

describe("dispatchTool", () => {
  it("autofill_open_slots runs the deterministic engine and yields a diff", () => {
    const out = dispatchTool("autofill_open_slots", {}, context());
    expect(out.kind).toBe("autofill");
    if (out.kind !== "autofill") return;
    expect(out.balanced).toBe(false);
    // Anna (lead) outranks Bjørn (capable) for a capable slot — engine decides.
    expect(out.diff.additions).toHaveLength(1);
    expect(out.diff.additions[0].member_id).toBe("anna");
    expect(out.diff.additions[0].member_name).toBe("Anna");
    expect(out.diff.additions[0].role_name).toBe("Lydtekniker");
    expect(out.diff.totalScore).toBe(out.diff.additions[0].score.total);
  });

  it("balanced_autofill carries fairness through", () => {
    const out = dispatchTool("balanced_autofill", {}, context());
    expect(out.kind).toBe("autofill");
    if (out.kind !== "autofill") return;
    expect(out.balanced).toBe(true);
    expect("fairness" in out.result).toBe(true);
  });

  it("check_conflicts runs the conflict engine", () => {
    const ctx = context({
      conflictContext: {
        services: [{ id: SVC, starts_at: SERVICE_AT }],
        // Double-book Anna into the same service to force a hard conflict.
        assignments: [
          { member_id: "anna", service_id: SVC, role_id: ROLE, skill_level: "lead", role_skill_required: "capable" },
          { member_id: "anna", service_id: SVC, role_id: "role-2", skill_level: "lead", role_skill_required: "capable" },
        ],
        members: [{ id: "anna", availability: [], max_assignments_per_month: 4 }],
      },
    });
    const out = dispatchTool("check_conflicts", {}, ctx);
    expect(out.kind).toBe("conflicts");
    if (out.kind !== "conflicts") return;
    expect(out.conflicts.some((c) => c.rule === "double_booking")).toBe(true);
  });

  it("coverage_report runs both coverage engines", () => {
    const out = dispatchTool("coverage_report", {}, context());
    expect(out.kind).toBe("coverage");
    if (out.kind !== "coverage") return;
    expect(out.service.lines).toHaveLength(1);
    expect(out.service.lines[0].requiredSlots).toBe(2);
    expect(out.balance.lines[0].name).toBe("Anna");
  });

  it("suggest_replacements errors safely on an unknown swap id", () => {
    const out = dispatchTool("suggest_replacements", { swap_id: "nope" }, context());
    expect(out.kind).toBe("error");
    if (out.kind !== "error") return;
    expect(out.error).toContain("unknown_swap_id");
  });

  it("suggest_setlist runs proposeSetlist when the input is present", () => {
    const ctx = context({
      setlistInputs: {
        [SVC]: {
          songs: [
            { id: "s1", title: "Nåde", themes: ["nåde"], last_used_at: null },
            { id: "s2", title: "Lovsang", themes: ["lovsang"], last_used_at: "2020-01-01" },
          ],
          themes: ["nåde"],
          count: 1,
        },
      },
    });
    const out = dispatchTool("suggest_setlist", { service_id: SVC }, ctx);
    expect(out.kind).toBe("setlist");
    if (out.kind !== "setlist") return;
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].title).toBe("Nåde");
  });

  it("never throws on an unknown tool — returns a recoverable error", () => {
    const out = dispatchTool("delete_everything", {}, context());
    expect(out.kind).toBe("error");
    if (out.kind !== "error") return;
    expect(out.error).toBe("unknown_tool:delete_everything");
  });

  it("never throws on a missing required arg", () => {
    expect(() => dispatchTool("suggest_replacements", {}, context())).not.toThrow();
    const out = dispatchTool("suggest_replacements", {}, context());
    expect(out.kind).toBe("error");
  });
});

// ── Diff computation (the accept-before-write contract) ───────────────────────

describe("computeAssignmentDiff", () => {
  it("denormalises names and sums the engine score (never fabricates one)", () => {
    const ctx = context();
    const result = {
      assignments: [
        { service_id: SVC, role_id: ROLE, member_id: "anna", rank: 1, score: { total: 80, warnings: [], components: [] } },
      ],
      unfilled: [{ service_id: SVC, role_id: "role-2", needed: 1, filled: 0, reason: "no_eligible_candidates" as const }],
    };
    const diff = computeAssignmentDiff(result, ctx, false);
    expect(diff.additions[0].member_name).toBe("Anna");
    expect(diff.unfilled[0].role_name).toBeUndefined(); // role-2 not in roleNames
    expect(diff.totalScore).toBe(80);
    expect(diff.balanced).toBe(false);
  });
});

// ── Request builder (pure, prompt-caching discipline) ─────────────────────────

describe("buildAgentRequest", () => {
  it("emits a cached system prompt + cached tool prefix", () => {
    const body = buildAgentRequest([{ role: "user", content: "Hei" }], DEFAULT_AGENT_MODEL) as {
      model: string;
      system: Array<{ text: string; cache_control?: unknown }>;
      tools: Array<{ name: string; cache_control?: unknown }>;
      messages: AnthropicMessage[];
    };
    expect(body.model).toBe(DEFAULT_AGENT_MODEL);
    expect(body.system[0].text).toBe(AGENT_SYSTEM_PROMPT);
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    // Only the LAST tool carries cache_control (caches the whole stable prefix).
    expect(body.tools).toHaveLength(AGENT_TOOLS.length);
    expect(body.tools[body.tools.length - 1].cache_control).toEqual({ type: "ephemeral" });
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.messages).toHaveLength(1);
  });

  it("exposes every engine as a tool with a strict schema", () => {
    const names = AGENT_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "autofill_open_slots",
        "balanced_autofill",
        "check_conflicts",
        "coverage_report",
        "suggest_replacements",
        "suggest_setlist",
      ].sort(),
    );
    for (const t of AGENT_TOOLS) {
      expect(t.input_schema.type).toBe("object");
      expect(t.input_schema.additionalProperties).toBe(false);
    }
  });
});

// ── Response parsing (pure, defensive) ────────────────────────────────────────

describe("parseAgentReply", () => {
  it("extracts text and tool_use blocks", () => {
    const parsed = parseAgentReply({
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Jeg sjekker." },
        { type: "tool_use", id: "tu_1", name: "autofill_open_slots", input: {} },
      ],
    });
    expect(parsed.text).toBe("Jeg sjekker.");
    expect(parsed.toolUses).toHaveLength(1);
    expect(parsed.toolUses[0].name).toBe("autofill_open_slots");
    expect(parsed.stopReason).toBe("tool_use");
  });

  it("tolerates an empty / malformed reply without throwing", () => {
    expect(parseAgentReply(undefined).toolUses).toEqual([]);
    expect(parseAgentReply({}).text).toBe("");
    expect(parseAgentReply({ content: "not-an-array" }).toolUses).toEqual([]);
  });
});

describe("buildToolResultMessage", () => {
  it("builds a user turn of tool_result blocks", () => {
    const msg = buildToolResultMessage([
      { tool_use_id: "tu_1", content: "{}" },
      { tool_use_id: "tu_2", content: "{\"error\":\"x\"}", is_error: true },
    ]);
    expect(msg.role).toBe("user");
    const blocks = msg.content as Array<Record<string, unknown>>;
    expect(blocks[0].tool_use_id).toBe("tu_1");
    expect(blocks[1].is_error).toBe(true);
  });
});

describe("summariseToolResult", () => {
  it("strips heavy internals to a compact JSON the model reads", () => {
    const out = dispatchTool("autofill_open_slots", {}, context());
    const summary = JSON.parse(summariseToolResult(out));
    expect(summary.proposed[0].member).toBe("Anna");
    expect(summary.proposed[0].role).toBe("Lydtekniker");
    expect(typeof summary.totalScore).toBe("number");
  });
});

// ── The agent loop (driven by a FAKE transport — no network, no key) ──────────

describe("runAgentLoop", () => {
  function transportScript(responses: unknown[]) {
    let i = 0;
    return vi.fn(async (_body: Record<string, unknown>) => responses[Math.min(i++, responses.length - 1)]);
  }

  it("dispatches a tool, feeds the result back, and returns the final reply + diff", async () => {
    const transport = transportScript([
      // turn 1: model asks to auto-fill
      {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_1", name: "autofill_open_slots", input: {} }],
      },
      // turn 2: model narrates the result and stops
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Jeg foreslår Anna til lydteknikerrollen — ingenting er lagret ennå." }],
      },
    ]);

    const out = await runAgentLoop(transport, DEFAULT_AGENT_MODEL, "Fyll de åpne rollene", [], context());

    expect(transport).toHaveBeenCalledTimes(2);
    expect(out.toolsUsed).toEqual(["autofill_open_slots"]);
    expect(out.diff).not.toBeNull();
    expect(out.diff!.additions[0].member_id).toBe("anna");
    expect(out.reply).toContain("Anna");
  });

  it("ends immediately when the model just talks (no tools)", async () => {
    const transport = transportScript([
      { stop_reason: "end_turn", content: [{ type: "text", text: "Hei! Hvordan kan jeg hjelpe?" }] },
    ]);
    const out = await runAgentLoop(transport, DEFAULT_AGENT_MODEL, "Hei", [], context());
    expect(transport).toHaveBeenCalledTimes(1);
    expect(out.diff).toBeNull();
    expect(out.toolsUsed).toEqual([]);
    expect(out.reply).toContain("Hei");
  });

  it("is bounded — never exceeds MAX_AGENT_TURNS even if the model loops", async () => {
    // Model keeps asking for tools forever; the loop must stop at the cap.
    const transport = vi.fn(async () => ({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tu_x", name: "check_conflicts", input: {} }],
    }));
    const out = await runAgentLoop(transport, DEFAULT_AGENT_MODEL, "loop", [], context());
    expect(transport).toHaveBeenCalledTimes(MAX_AGENT_TURNS);
    expect(out.toolsUsed.length).toBe(MAX_AGENT_TURNS);
  });

  it("a hallucinated tool name degrades to a recoverable error, never a crash", async () => {
    const transport = transportScript([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "wipe_db", input: {} }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Beklager, det kan jeg ikke." }] },
    ]);
    const out = await runAgentLoop(transport, DEFAULT_AGENT_MODEL, "slett alt", [], context());
    // Unknown tool isn't recorded as used, no diff produced, loop still completes.
    expect(out.toolsUsed).toEqual([]);
    expect(out.diff).toBeNull();
    expect(out.reply).toContain("Beklager");
  });

  it("carries prior history into the request", async () => {
    const transport = transportScript([
      { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] },
    ]);
    const history: AnthropicMessage[] = [
      { role: "user", content: "Tidligere melding" },
      { role: "assistant", content: [{ type: "text", text: "Tidligere svar" }] },
    ];
    await runAgentLoop(transport, DEFAULT_AGENT_MODEL, "ny melding", history, context());
    const body = transport.mock.calls[0][0] as { messages: AnthropicMessage[] };
    // History is prepended, then the new user turn at index 2. (The loop appends
    // the assistant reply to the same array afterwards, so length may be >3 by
    // assertion time — the load-bearing check is that history + new msg lead.)
    expect(body.messages[0]).toEqual({ role: "user", content: "Tidligere melding" });
    expect(body.messages[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "Tidligere svar" }] });
    expect(body.messages[2]).toEqual({ role: "user", content: "ny melding" });
  });
});
