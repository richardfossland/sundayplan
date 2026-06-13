/**
 * Pure, network-free helpers for natural-language booking (Phase 4, feature 1).
 *
 * The LLM never books anything: it returns STRUCTURED fields (a "draft"), and
 * the helpers here turn that draft into a `BookingProposal` that PRE-FILLS the
 * existing create-booking form. A human always confirms before POST /api/bookings,
 * and the DB exclusion constraint + RPC remain the only real guard.
 *
 * Three independently-tested pieces:
 *   1. `foldDiacritics` + `fuzzyMatchResource` — token/diacritic-folded match of
 *      the model's named resources/event-type against the church's own rows.
 *   2. `interpretNorwegianDateTime` — turn the model's structured date/time
 *      fields (ISO date + HH:MM, or a few Norwegian phrases) into a concrete
 *      local datetime-local string the form binds to.
 *   3. `draftToProposal` — validate + normalize a (possibly mis-shaped) model
 *      draft into a BookingProposal, dropping anything that doesn't resolve.
 *
 * All of this is deterministic; `nl-booking.test.ts` drives it with canned LLM
 * JSON fixtures and no API key.
 */

// ── The strict shape we ask the model to return ──────────────────────────────

/**
 * What the LLM is instructed to emit (see the route's system prompt). Every
 * field is optional/loosely-typed because a model can omit or mangle anything;
 * `draftToProposal` is the gate that turns this into something trustworthy.
 */
export interface NlBookingDraft {
  /** Free-text title for the booking (e.g. "Konfirmasjon"). */
  title?: unknown;
  /** Resource names the model extracted, e.g. ["storsalen", "projektor"]. */
  resources?: unknown;
  /** Event-type name, e.g. "konfirmasjon". */
  eventType?: unknown;
  /** ISO date `YYYY-MM-DD` for the start, if the model resolved one. */
  date?: unknown;
  /** `HH:MM` 24h start time. */
  startTime?: unknown;
  /** `HH:MM` 24h end time, if given. */
  endTime?: unknown;
  /** Duration in minutes, if the model gave a duration instead of an end. */
  durationMin?: unknown;
  /** Headcount / capacity hint, e.g. 60 (chairs / seats). */
  capacity?: unknown;
  /** Extra requested items as free text, e.g. ["projektor", "60 stoler"]. */
  extras?: unknown;
  /** Relative-day hints the model may emit instead of an ISO date. */
  relativeDay?: unknown;
}

// ── Public proposal shape (what the form consumes) ────────────────────────────

export interface ProposalResourceMatch {
  /** The model's raw term, e.g. "storsalen". */
  term: string;
  /** Resolved resource id, or null when no confident match was found. */
  resourceId: string | null;
  /** The matched resource name (for display), or null. */
  resourceName: string | null;
  /** 0..1 confidence of the fuzzy match. */
  score: number;
}

export interface BookingProposal {
  title: string | null;
  /** Matched resources (resolved + unresolved, so the UI can show both). */
  resources: ProposalResourceMatch[];
  /** Resolved event_type id, or null. */
  eventTypeId: string | null;
  eventTypeName: string | null;
  /** Local `YYYY-MM-DDTHH:mm` start, or null when no date/time resolved. */
  start: string | null;
  /** Local `YYYY-MM-DDTHH:mm` end, or null. */
  end: string | null;
  /** Headcount the model extracted, or null. */
  capacity: number | null;
  /** Extra items as plain strings (shown as notes / chips), never auto-applied. */
  extras: string[];
  /** Human-readable notes about what could NOT be resolved (for the UI). */
  unresolved: string[];
}

// ── 1. Diacritic-folded fuzzy matching ────────────────────────────────────────

/**
 * Lower-case + strip Norwegian/Latin diacritics so "Storsalen" matches
 * "storsalen", "kjØkken" matches "kjokken", etc. Uses NFD decomposition then
 * removes combining marks, plus explicit æ/ø/å folding (which don't decompose).
 */
export function foldDiacritics(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining marks
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .trim();
}

/** Tokenize a folded string into word tokens (letters+digits). */
export function tokenize(s: string): string[] {
  return foldDiacritics(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Token-overlap similarity in [0,1] between a query and a candidate name.
 * 1.0 = the query tokens are a subset of (or equal to) the candidate's, scaled
 * by coverage; small bonus for an exact folded-substring containment so
 * "storsal" still strongly matches "Storsalen".
 */
export function nameSimilarity(query: string, candidate: string): number {
  const q = tokenize(query);
  const c = tokenize(candidate);
  if (q.length === 0 || c.length === 0) return 0;

  const cSet = new Set(c);
  let hits = 0;
  for (const tok of q) {
    if (cSet.has(tok)) {
      hits += 1;
      continue;
    }
    // partial: a query token that is a prefix of (or contained in) any candidate
    // token (handles "storsal" vs "storsalen", "projekt" vs "projektor").
    if (c.some((ct) => ct.startsWith(tok) || tok.startsWith(ct) || ct.includes(tok))) {
      hits += 0.75;
    }
  }
  const tokenScore = hits / q.length;

  // Whole-string containment bonus (folded), capped so it can't exceed 1.
  const qf = foldDiacritics(query).replace(/\s+/g, "");
  const cf = foldDiacritics(candidate).replace(/\s+/g, "");
  const containment = qf && cf && (cf.includes(qf) || qf.includes(cf)) ? 0.15 : 0;

  return Math.min(1, tokenScore + containment);
}

export interface MatchableResource {
  id: string;
  name: string;
}

/**
 * Resolve a single model term against the church's resources by fuzzy name
 * match. Returns the best candidate above `threshold`, else a null match (so
 * the UI surfaces "not found" rather than guessing wrong).
 */
export function fuzzyMatchResource(
  term: string,
  resources: MatchableResource[],
  threshold = 0.5,
): ProposalResourceMatch {
  let best: { r: MatchableResource; score: number } | null = null;
  for (const r of resources) {
    const score = nameSimilarity(term, r.name);
    if (!best || score > best.score) best = { r, score };
  }
  if (!best || best.score < threshold) {
    return { term, resourceId: null, resourceName: null, score: best?.score ?? 0 };
  }
  return { term, resourceId: best.r.id, resourceName: best.r.name, score: best.score };
}

// ── 2. Norwegian date/time interpreter ────────────────────────────────────────

/** Norwegian month names → 1-based month number (handles a couple of variants). */
const NB_MONTHS: Record<string, number> = {
  januar: 1, jan: 1,
  februar: 2, feb: 2,
  mars: 3, mar: 3,
  april: 4, apr: 4,
  mai: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10,
  november: 11, nov: 11,
  desember: 12, des: 12,
};

const NB_WEEKDAYS: Record<string, number> = {
  // 1=Mon … 7=Sun (ISO), folded
  mandag: 1, tirsdag: 2, onsdag: 3, torsdag: 4, fredag: 5, lordag: 6, sondag: 7,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Build a local `YYYY-MM-DDTHH:mm` string from y/m/d/hh/mm parts. */
export function buildLocalDateTime(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
): string {
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}`;
}

export interface InterpretInput {
  /** ISO `YYYY-MM-DD` from the model, if present. */
  date?: string | null;
  /** `HH:MM` 24h start. */
  startTime?: string | null;
  /** Free-text relative day ("i dag" | "i morgen" | "<weekday>"), folded-tolerant. */
  relativeDay?: string | null;
  /** "now" anchor; injectable for tests. Defaults to new Date(). */
  now?: Date;
}

export interface InterpretedStart {
  /** Local `YYYY-MM-DDTHH:mm`, or null if neither a date nor a relative day resolved. */
  start: string | null;
  /** Whether a time component was actually supplied (else defaulted to 12:00). */
  hadTime: boolean;
}

/** Parse a `HH:MM` (or `HH.MM`) 24h string → {hh,mm} or null. */
export function parseClock(s: string | null | undefined): { hh: number; mm: number } | null {
  if (!s) return null;
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(s).trim());
  if (!m) {
    // also accept a bare hour like "12"
    const h = /^(\d{1,2})$/.exec(String(s).trim());
    if (!h) return null;
    const hh = Number(h[1]);
    if (hh > 23) return null;
    return { hh, mm: 0 };
  }
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return { hh, mm };
}

/**
 * Resolve the model's date fields to a concrete local start datetime.
 *
 * Priority: explicit ISO `date` > `relativeDay` phrase. Time comes from
 * `startTime`; when absent we default to 12:00 (noon) and flag `hadTime=false`
 * so the UI can hint the planner to confirm the hour.
 */
export function interpretNorwegianDateTime(input: InterpretInput): InterpretedStart {
  const now = input.now ?? new Date();
  const clock = parseClock(input.startTime ?? null);
  const hh = clock?.hh ?? 12;
  const mm = clock?.mm ?? 0;

  // 1. Explicit ISO date.
  if (input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date.trim())) {
    const [y, m, d] = input.date.trim().split("-").map(Number);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return { start: buildLocalDateTime(y, m, d, hh, mm), hadTime: clock !== null };
    }
  }

  // 2. Relative day phrase.
  const rel = input.relativeDay ? foldDiacritics(input.relativeDay) : "";
  if (rel) {
    const base = new Date(now);
    base.setHours(hh, mm, 0, 0);
    if (rel === "i dag" || rel === "idag") {
      return { start: localOf(base), hadTime: clock !== null };
    }
    if (rel === "i morgen" || rel === "imorgen" || rel === "imorra") {
      base.setDate(base.getDate() + 1);
      return { start: localOf(base), hadTime: clock !== null };
    }
    if (rel === "i overmorgen") {
      base.setDate(base.getDate() + 2);
      return { start: localOf(base), hadTime: clock !== null };
    }
    // "<weekday>" → the NEXT occurrence (strictly in the future).
    const targetIso = NB_WEEKDAYS[rel];
    if (targetIso) {
      const curIso = ((now.getDay() + 6) % 7) + 1; // JS 0=Sun → ISO 1=Mon..7=Sun
      let delta = (targetIso - curIso + 7) % 7;
      if (delta === 0) delta = 7; // "next" weekday, not today
      base.setDate(base.getDate() + delta);
      return { start: localOf(base), hadTime: clock !== null };
    }
  }

  return { start: null, hadTime: false };
}

function localOf(d: Date): string {
  return buildLocalDateTime(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
  );
}

/** Add minutes to a local `YYYY-MM-DDTHH:mm` string, returning the same shape. */
export function addMinutesToLocal(local: string, minutes: number): string {
  const d = new Date(local);
  d.setMinutes(d.getMinutes() + minutes);
  return localOf(d);
}

// Expose the month map for the prompt/help (not used in matching directly, but
// kept so a future free-text parser path can reuse it).
export const NORWEGIAN_MONTHS = NB_MONTHS;

// ── 3. Draft → Proposal normalizer ────────────────────────────────────────────

export interface DraftToProposalCtx {
  resources: MatchableResource[];
  eventTypes: { id: string; name: string; default_duration_min: number }[];
  now?: Date;
  /** Default duration (min) when neither end nor duration nor event-type gives one. */
  defaultDurationMin?: number;
  resourceThreshold?: number;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(asString).filter((x): x is string => x !== null);
}

/**
 * Turn a (possibly mis-shaped) LLM draft into a normalized BookingProposal.
 * Fuzzy-matches resources + event type against the church's own rows; resolves
 * the start via the Norwegian interpreter; derives the end from end-time, then
 * duration, then the event-type default, then the global default. Never throws,
 * never books — anything unresolved is reported in `unresolved`.
 */
export function draftToProposal(
  draft: NlBookingDraft,
  ctx: DraftToProposalCtx,
): BookingProposal {
  const unresolved: string[] = [];
  const threshold = ctx.resourceThreshold ?? 0.5;

  // Resources
  const terms = asStringArray(draft.resources);
  const resources = terms.map((term) => fuzzyMatchResource(term, ctx.resources, threshold));
  for (const r of resources) {
    if (!r.resourceId) unresolved.push(`resource:${r.term}`);
  }

  // Event type
  const evName = asString(draft.eventType);
  let eventTypeId: string | null = null;
  let eventTypeName: string | null = null;
  let evDefaultDuration: number | null = null;
  if (evName) {
    let best: { id: string; name: string; dur: number; score: number } | null = null;
    for (const et of ctx.eventTypes) {
      const score = nameSimilarity(evName, et.name);
      if (!best || score > best.score) {
        best = { id: et.id, name: et.name, dur: et.default_duration_min, score };
      }
    }
    if (best && best.score >= threshold) {
      eventTypeId = best.id;
      eventTypeName = best.name;
      evDefaultDuration = best.dur;
    } else {
      unresolved.push(`eventType:${evName}`);
    }
  }

  // Start
  const interpreted = interpretNorwegianDateTime({
    date: asString(draft.date),
    startTime: asString(draft.startTime),
    relativeDay: asString(draft.relativeDay),
    now: ctx.now,
  });
  const start = interpreted.start;
  if (!start) unresolved.push("date");
  else if (!interpreted.hadTime) unresolved.push("time");

  // End: endTime > durationMin > event-type default > global default.
  let end: string | null = null;
  if (start) {
    const endClock = parseClock(asString(draft.endTime));
    if (endClock) {
      const [datePart] = start.split("T");
      end = `${datePart}T${pad2(endClock.hh)}:${pad2(endClock.mm)}`;
      // If end <= start (crossed nothing / model gave an earlier hour), fall back.
      if (new Date(end) <= new Date(start)) end = null;
    }
    if (!end) {
      const dur =
        asNumber(draft.durationMin) ??
        evDefaultDuration ??
        ctx.defaultDurationMin ??
        60;
      end = addMinutesToLocal(start, dur > 0 ? dur : 60);
    }
  }

  const extras = asStringArray(draft.extras);
  const capacity = asNumber(draft.capacity);

  return {
    title: asString(draft.title) ?? eventTypeName ?? null,
    resources,
    eventTypeId,
    eventTypeName,
    start,
    end,
    capacity,
    extras,
    unresolved,
  };
}
