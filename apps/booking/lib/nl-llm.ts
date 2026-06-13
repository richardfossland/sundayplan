/**
 * SERVER-ONLY Claude seam for natural-language booking (Phase 4, feature 1).
 *
 * Mirrors the suite's established AI-seam discipline (see
 * packages/sdk/src/rationale-refiner.ts):
 *   • `getBookingParser(env)` returns `null` when there is no ANTHROPIC_API_KEY
 *     — the keyless/offline path. Callers then surface "AI ikke tilgjengelig"
 *     and the manual form keeps working.
 *   • Dependency-free: talks to the Messages API over `fetch`, so the app needs
 *     no Anthropic SDK and the whole thing tree-shakes/no-ops without a key.
 *   • The model ONLY proposes structured fields; `draftToProposal` (pure) is the
 *     gate, and a human confirms before any POST /api/bookings. The DB exclusion
 *     constraint + RPC remain the real guard — the model can never book.
 *
 * Model: `claude-opus-4-8` by default (SundayPlan does not pin a NL-parse model
 * constant; the rationale refiner pins haiku for cheap copy, but structured
 * extraction wants the stronger model). Overridable via SUNDAYPLAN_BOOKING_MODEL.
 */

import type { NlBookingDraft } from "./nl-booking";

/**
 * The minimal env we read — `process.env`-shaped (an index signature), but the
 * fields we care about are named for clarity. Kept assignable from
 * `process.env` (NodeJS.ProcessEnv) so callers can pass it directly.
 */
export type BookingParserEnv = Record<string, string | undefined>;

const DEFAULT_MODEL = "claude-opus-4-8";
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/** Context the church supplies so the model maps onto REAL resource/type names. */
export interface ParseContext {
  /** The church's resource names (the model is told to use only these). */
  resourceNames: string[];
  /** The church's event-type names. */
  eventTypeNames: string[];
  /** Today's date `YYYY-MM-DD` in the church's locale, to resolve relative dates. */
  today: string;
}

export interface BookingParser {
  /** Parse a Norwegian booking request into a structured draft (never books). */
  parse(prompt: string, ctx: ParseContext): Promise<NlBookingDraft>;
}

/** Construct a Claude-backed parser, or `null` when no API key is present. */
export function getBookingParser(env: BookingParserEnv | undefined): BookingParser | null {
  const apiKey = env?.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env?.SUNDAYPLAN_BOOKING_MODEL?.trim() || DEFAULT_MODEL;
  return new ClaudeBookingParser(apiKey, model);
}

// The strict tool the model must call — this is our JSON schema for the draft.
const EXTRACT_TOOL = {
  name: "booking_draft",
  description:
    "Return the structured fields extracted from a Norwegian room/resource " +
    "booking request. Use ONLY resource and event-type names from the provided " +
    "lists; omit any field you cannot determine. Never invent times or dates.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short title for the booking." },
      resources: {
        type: "array",
        items: { type: "string" },
        description: "Resource names, chosen from the church's resource list.",
      },
      eventType: { type: "string", description: "Event-type name from the list." },
      date: { type: "string", description: "Start date as ISO YYYY-MM-DD." },
      startTime: { type: "string", description: "Start time as HH:MM (24h)." },
      endTime: { type: "string", description: "End time as HH:MM (24h), if stated." },
      durationMin: { type: "number", description: "Duration in minutes, if stated." },
      capacity: { type: "number", description: "Headcount / seats, if stated." },
      extras: {
        type: "array",
        items: { type: "string" },
        description: "Extra requested items as free text (e.g. '60 stoler').",
      },
      relativeDay: {
        type: "string",
        description: "Relative day phrase if no ISO date (e.g. 'i morgen', 'fredag').",
      },
    },
    additionalProperties: false,
  },
} as const;

function systemPrompt(ctx: ParseContext): string {
  return [
    "Du tolker norske bookingforespørsler for et kirke-rombooking-system.",
    "Hent ut strukturerte felter og kall verktøyet `booking_draft`.",
    "Regler:",
    "- Bruk KUN ressursnavn fra denne lista: " + JSON.stringify(ctx.resourceNames) + ".",
    "- Bruk KUN hendelsestyper fra denne lista: " + JSON.stringify(ctx.eventTypeNames) + ".",
    "- I dag er " + ctx.today + ". Tolk relative datoer ut fra dette.",
    "- Datoer som ISO YYYY-MM-DD; klokkeslett som HH:MM (24-timers).",
    "- Du BOOKER ingenting — du foreslår kun felter. Utelat felter du er usikker på.",
  ].join("\n");
}

class ClaudeBookingParser implements BookingParser {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async parse(prompt: string, ctx: ParseContext): Promise<NlBookingDraft> {
    const body = {
      model: this.model,
      max_tokens: 512,
      system: [
        {
          type: "text",
          text: systemPrompt(ctx),
          // Cache the (stable) instruction + resource lists for repeat parses.
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
      messages: [{ role: "user", content: prompt }],
    };

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

    if (!res.ok) throw new Error(`booking-parser: ${res.status}`);

    const json = (await res.json()) as {
      content?: Array<{ type: string; name?: string; input?: unknown; text?: string }>;
    };
    // Prefer the tool_use block's structured input.
    const tool = json.content?.find(
      (c) => c.type === "tool_use" && c.name === EXTRACT_TOOL.name,
    );
    if (tool && tool.input && typeof tool.input === "object") {
      return tool.input as NlBookingDraft;
    }
    // Fallback: a text block containing JSON (defensive — draftToProposal will
    // still sanitize whatever shape this is).
    const text = json.content?.find((c) => c.type === "text")?.text ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as NlBookingDraft;
      } catch {
        /* fall through */
      }
    }
    return {};
  }
}
