/**
 * Claude-backed rationale refiner (Phase 9 NL polish).
 *
 * Wraps the `RationaleRefiner` seam in scoring.ts with a real Anthropic
 * Messages-API call so the terse, mechanical scoring/conflict copy can be
 * rephrased into warmer, planner-facing English. Dependency-free: it talks to
 * the API over `fetch` (mirroring the SundaySong sibling), so the SDK package
 * stays free of an SDK dependency and the whole thing tree-shakes away when no
 * key is configured.
 *
 * Discipline, identical to the rest of the AI seams in this package:
 *   • `getRationaleRefiner(env)` returns `null` when there's no API key — the
 *     free/offline path. Callers then fall back to the existing strings.
 *   • The refiner only ever rewrites text; scoring.ts re-applies the numbers,
 *     so a hallucinating model can never move a score. `refineBreakdown`
 *     additionally drops mis-shaped responses.
 *   • Prompt caching: the system prompt (tone guidelines) is marked with
 *     `cache_control` so repeated refinements within the 5-minute window only
 *     pay for the small per-request draft. Combined with the in-memory cache in
 *     `refineBreakdown`, identical breakdowns don't re-request at all.
 */

import type { RationaleDraft, RationaleRefiner } from "./scoring";

/** The minimal env we read — `process.env`-shaped, but injectable for tests. */
export interface RefinerEnv {
  ANTHROPIC_API_KEY?: string;
  /** Override the model; defaults to a fast, cheap one for short copy. */
  SUNDAYPLAN_REFINER_MODEL?: string;
}

const DEFAULT_MODEL = "claude-haiku-4-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/** Tone guidelines — kept stable + cacheable across requests. */
const SYSTEM_PROMPT = [
  "You polish short scheduling rationale lines for a church volunteer-planning",
  "app used by busy, non-technical volunteers. Rewrite each line to be warm,",
  "clear and plainly human — never robotic. Keep it concise (the original",
  "length or shorter). Preserve every concrete number, name and date exactly.",
  "Do not add facts, advice or emoji. British/neutral English.",
  "",
  "For kind=conflict, keep the cautioning tone — these flag problems to fix.",
  "For kind=recommendation, keep it encouraging — these explain a good match.",
  "",
  "Return ONLY a JSON object: {\"explanations\": string[], \"warnings\": string[]}",
  "with the SAME number of items, in the SAME order, as the input arrays.",
].join("\n");

/**
 * Construct a Claude-backed refiner, or `null` if no API key is present.
 * The returned refiner is safe to pass straight to `refineBreakdown`.
 */
export function getRationaleRefiner(env: RefinerEnv | undefined): RationaleRefiner | null {
  const apiKey = env?.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env?.SUNDAYPLAN_REFINER_MODEL?.trim() || DEFAULT_MODEL;
  return new ClaudeRationaleRefiner(apiKey, model);
}

class ClaudeRationaleRefiner implements RationaleRefiner {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async refine(draft: RationaleDraft): Promise<RationaleDraft> {
    const body = {
      model: this.model,
      max_tokens: 512,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          // Cache the tone guidelines so repeated polish calls are cheap.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            kind: draft.kind,
            explanations: draft.explanations,
            warnings: draft.warnings,
          }),
        },
      ],
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

    if (!res.ok) {
      // Surface as a throw; refineBreakdown catches and keeps the originals.
      throw new Error(`refiner: ${res.status}`);
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = json.content?.find((c) => c.type === "text")?.text ?? "";
    const parsed = JSON.parse(extractJson(text)) as Omit<RationaleDraft, "kind">;
    // Force our kind (ignore any the model echoed); scoring.ts validates the rest.
    return { kind: draft.kind, explanations: parsed.explanations, warnings: parsed.warnings };
  }
}

/**
 * Pull the first JSON object out of a model reply, tolerating ```json fences or
 * incidental prose around it. Throws (→ caught upstream) if none is found.
 */
function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("refiner: no JSON in reply");
  }
  return text.slice(start, end + 1);
}
