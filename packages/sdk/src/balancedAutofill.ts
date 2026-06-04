/**
 * Global-fairness auto-fill orchestrator — the burnout-reduction centerpiece.
 *
 * The base `autoFill` (autofill.ts) is a single-pass, per-slot greedy fill:
 * it picks the top-scoring eligible candidate for each slot in the order the
 * slots are given. That biases the outcome by slot order and does NO global
 * balancing — an eager volunteer who ranks #1 everywhere can be loaded into
 * every slot while equally-eligible peers sit idle. That is the #1 driver of
 * volunteer burnout, the #1 retention lever for a small church.
 *
 * `balancedAutoFill` keeps the greedy pass as its starting point, then runs a
 * deterministic flattening loop that performs *improving moves* — reassigning a
 * slot from an over-loaded volunteer to an under-loaded but eligible one — to
 * shrink the spread of load across the whole planning window, WITHOUT ever:
 *   • introducing a hard-constraint violation (unavailable / credential-blocked
 *     / over-cap / double-booked), or
 *   • materially lowering the total relevance score (an explicit epsilon rule).
 *
 * It is pure and deterministic: same input → same plan, same fairness summary.
 * It composes the existing engines (`scoreCandidate`, the conflict severities)
 * rather than reinventing them; the base `autoFill` is untouched and remains
 * the default path.
 *
 * ── Load model & cumulative fairness ─────────────────────────────────────────
 * "Load" for a member = `window_serves_prior` (serves they already carry coming
 * INTO this planning window — the cumulative-fairness signal) + the number of
 * slots this run has assigned them. Threading `window_serves_prior` (default 0,
 * so existing behaviour is byte-identical) is what stops early volunteers from
 * being hammered: a planner who fills January, then February, then March passes
 * the running totals forward, so the orchestrator flattens against the WHOLE
 * window, not just whatever it sees this call.
 *
 * ── Acceptance rule for a move ───────────────────────────────────────────────
 * A reassignment from member `out` to member `in` on a slot is accepted iff:
 *   1. `in` is eligible for the slot (scored — i.e. available + not hard-gated)
 *      and is not already assigned in that service (no double-book), and
 *      placing `in` introduces no hard conflict the checker reports.
 *   2. It STRICTLY reduces the global max−min load gap (a true improvement), OR
 *      reduces the sum of squared loads while not increasing the gap (a Pareto
 *      flattening that evens the middle without widening the extremes).
 *   3. Total relevance score stays within `epsilon` of the pre-move total
 *      (`scoreDelta >= -epsilon`). Equally-scored swaps (delta 0) are fine; a
 *      swap that loses more than epsilon of fit is rejected even if it flattens.
 * Pinned/manual assignments are never the `out` side. A slot is left unfilled
 * rather than assigned to an ineligible candidate — the loop only ever moves a
 * slot BETWEEN eligible candidates, never onto an ineligible one.
 */

import type { ScoreBreakdown } from "@sundayplan/shared";
import { scoreCandidate } from "./scoring";
import type { AutoFillCandidate, AutoFillResult, AutoFillSlot, ProposedAssignment, UnfilledSlot } from "./autofill";

/** Default acceptance epsilon: a move may cost at most this much total score. */
export const DEFAULT_BALANCE_EPSILON = 2.0;

export interface BalancedAutoFillOptions {
  /**
   * Max total relevance score a flattening move may sacrifice. A move is only
   * accepted if it keeps the plan's total score within this many points of the
   * pre-move total. Defaults to {@link DEFAULT_BALANCE_EPSILON}. `0` means
   * "only score-neutral or score-improving moves".
   */
  epsilon?: number;
  /**
   * Safety cap on flattening iterations (the loop also stops on its own when no
   * improving move exists). Deterministic regardless; this just bounds work on
   * pathological inputs. Default 1000.
   */
  maxIterations?: number;
}

/** Why a balancing move was applied — surfaced so a planner can audit it. */
export interface AppliedSwap {
  service_id: string;
  role_id: string;
  /** Member moved OFF the slot (was over-loaded). */
  from_member_id: string;
  /** Member moved ONTO the slot (was under-loaded, still eligible). */
  to_member_id: string;
  /** Load of `from_member_id` before the move (cumulative across the window). */
  from_load_before: number;
  /** Load of `to_member_id` before the move. */
  to_load_before: number;
  /** Total relevance score change (≤ 0 means a small, accepted fit cost). */
  score_delta: number;
  /** Global max−min load gap immediately after this move. */
  gap_after: number;
  reason: string;
}

export interface MemberLoadLine {
  member_id: string;
  /** Serves carried into the window (the cumulative-fairness prior). */
  prior: number;
  /** Slots assigned to this member in THIS run. */
  assigned: number;
  /** prior + assigned — the figure the orchestrator flattens. */
  load: number;
}

export interface FairnessSummary {
  /** Per-eligible-volunteer load, sorted heaviest-first then by id. */
  perMember: MemberLoadLine[];
  /** max−min load gap across eligible volunteers before flattening. */
  gapBefore: number;
  /** max−min load gap across eligible volunteers after flattening. */
  gapAfter: number;
  /** Total relevance score of all assignments before flattening. */
  totalScoreBefore: number;
  /** Total relevance score of all assignments after flattening. */
  totalScoreAfter: number;
  /** Moves the flattening loop applied, in order. */
  swaps: AppliedSwap[];
}

export interface BalancedAutoFillResult extends AutoFillResult {
  fairness: FairnessSummary;
}

/**
 * A slot whose members may carry a "pinned" flag (a locked/manual assignment)
 * and where each candidate may declare a cumulative-window prior. This is a
 * superset of {@link AutoFillSlot}; the extra fields are all optional so an
 * existing `AutoFillSlot[]` flows straight through (priors default to 0, no
 * candidate pinned).
 */
export type BalancedAutoFillSlot = AutoFillSlot;

// ── Internal working model ───────────────────────────────────────────────────

interface ScoredCand {
  member_id: string;
  joined_at: string | null;
  score: ScoreBreakdown;
  prior: number;
}

interface WorkSlot {
  service_id: string;
  role_id: string;
  quantity: number;
  /** Eligible (scored, available, not credential-gated) candidates, ranked. */
  eligible: ScoredCand[];
  /** member_id → score breakdown, for O(1) lookup during moves. */
  scoreOf: Map<string, ScoreBreakdown>;
  /** member_id → cumulative prior, for the load model. */
  priorOf: Map<string, number>;
  /** member_ids pinned/locked into this slot — never moved off, count to load. */
  pinned: string[];
  /** Currently-chosen member_ids for the auto-fillable portion (non-pinned). */
  chosen: string[];
}

/**
 * Read the optional balancing extensions off a candidate without widening the
 * public `AutoFillCandidate` type's required surface. `window_serves_prior` and
 * `pinned` are read defensively; absent → 0 / false (existing behaviour).
 */
function priorOf(c: AutoFillCandidate): number {
  const p = c.window_serves_prior;
  return typeof p === "number" && p >= 0 ? p : 0;
}
function isPinned(c: AutoFillCandidate): boolean {
  return c.pinned === true;
}

/** Deterministic candidate ranking — mirrors autofill.ts exactly. */
function compareScored(a: ScoredCand, b: ScoredCand): number {
  if (b.score.total !== a.score.total) return b.score.total - a.score.total;
  if (a.joined_at !== b.joined_at) {
    if (a.joined_at === null) return 1;
    if (b.joined_at === null) return -1;
    return a.joined_at < b.joined_at ? -1 : 1;
  }
  if (a.member_id < b.member_id) return -1;
  if (a.member_id > b.member_id) return 1;
  return 0;
}

/**
 * Global-fairness auto-fill. Runs the greedy `autoFill` first (identical
 * proposals), then flattens load with accepted moves. Backward-compatible: pass
 * a plain `AutoFillSlot[]` and it behaves like `autoFill` plus a fairness
 * summary; richer behaviour kicks in when candidates carry `window_serves_prior`
 * and/or `pinned`.
 */
export function balancedAutoFill(
  slots: AutoFillSlot[],
  options: BalancedAutoFillOptions = {},
): BalancedAutoFillResult {
  const epsilon = options.epsilon ?? DEFAULT_BALANCE_EPSILON;
  const maxIterations = options.maxIterations ?? 1000;

  // ── 1. Greedy baseline (the existing, trusted pass) ─────────────────────────
  // We re-derive its result *inside* a working model so we can mutate from it.
  const work = buildWorkModel(slots);

  // Member → set of services they're assigned in (double-book guard) over the
  // whole plan (pinned + chosen). Built fresh from the working model.
  const servicesOf = buildServiceIndex(work);
  // Member → cumulative load (prior + count of assignments this run).
  const load = buildLoadIndex(work);
  // The universe of eligible volunteers — anyone who could legitimately serve a
  // slot. The gap is measured across THIS set (idle-but-eligible peers count as
  // load 0, which is exactly the burnout signal we want to flatten).
  const eligibleUniverse = buildEligibleUniverse(work);

  const baselineAssignments = collectAssignments(work);
  const gapBefore = loadGap(eligibleUniverse, load);
  const totalScoreBefore = round1(
    baselineAssignments.reduce((s, a) => s + a.score.total, 0),
  );

  // ── 2. Flattening loop ──────────────────────────────────────────────────────
  const swaps: AppliedSwap[] = [];
  let iterations = 0;
  let improved = true;
  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;
    const move = bestImprovingMove(work, servicesOf, load, eligibleUniverse, epsilon);
    if (!move) break;
    applyMove(servicesOf, load, move);
    swaps.push({
      service_id: move.slot.service_id,
      role_id: move.slot.role_id,
      from_member_id: move.out,
      to_member_id: move.in,
      from_load_before: move.fromLoadBefore,
      to_load_before: move.toLoadBefore,
      score_delta: round1(move.scoreDelta),
      gap_after: move.gapAfter,
      reason:
        `Moved from ${move.out} (load ${move.fromLoadBefore}) to ${move.in} ` +
        `(load ${move.toLoadBefore}); gap ${move.gapBefore}→${move.gapAfter}`,
    });
    improved = true;
  }

  // ── 3. Final result + fairness summary ──────────────────────────────────────
  const finalAssignments = collectAssignments(work);
  const gapAfter = loadGap(eligibleUniverse, load);
  const totalScoreAfter = round1(finalAssignments.reduce((s, a) => s + a.score.total, 0));

  const unfilled = computeUnfilled(work);

  return {
    assignments: finalAssignments,
    unfilled,
    fairness: {
      perMember: buildPerMember(eligibleUniverse, work, load),
      gapBefore,
      gapAfter,
      totalScoreBefore,
      totalScoreAfter,
      swaps,
    },
  };
}

// ── Working-model construction ────────────────────────────────────────────────

function buildWorkModel(slots: AutoFillSlot[]): WorkSlot[] {
  // First, mirror the greedy pass's per-service double-book bookkeeping so the
  // baseline `chosen` matches `autoFill` exactly (including slot order).
  const assignedInService = new Map<string, Set<string>>();
  const work: WorkSlot[] = [];

  for (const slot of slots) {
    let taken = assignedInService.get(slot.service_id);
    if (!taken) assignedInService.set(slot.service_id, (taken = new Set<string>()));

    const eligible: ScoredCand[] = [];
    const scoreOf = new Map<string, ScoreBreakdown>();
    const priorMap = new Map<string, number>();
    const pinned: string[] = [];

    for (const c of slot.candidates) {
      const score = scoreCandidate(c.inputs);
      if (isPinned(c)) {
        // A pinned member occupies the slot regardless of score; they still
        // count toward double-book and load. (Pinned implies the planner placed
        // them, so we don't re-validate eligibility — we just never move them.)
        pinned.push(c.member_id);
        priorMap.set(c.member_id, priorOf(c));
        taken.add(c.member_id);
        continue;
      }
      if (score === null) continue; // availability / hard gate
      eligible.push({ member_id: c.member_id, joined_at: c.joined_at, score, prior: priorOf(c) });
      scoreOf.set(c.member_id, score);
      priorMap.set(c.member_id, priorOf(c));
    }
    eligible.sort(compareScored);

    // Greedy fill of the remaining (non-pinned) capacity.
    const capacity = Math.max(0, slot.quantity - pinned.length);
    const chosen: string[] = [];
    for (let i = 0; i < eligible.length && chosen.length < capacity; i++) {
      const m = eligible[i].member_id;
      if (taken.has(m)) continue; // no double-book in this service
      chosen.push(m);
      taken.add(m);
    }

    work.push({
      service_id: slot.service_id,
      role_id: slot.role_id,
      quantity: slot.quantity,
      eligible,
      scoreOf,
      priorOf: priorMap,
      pinned,
      chosen,
    });
  }
  return work;
}

/** member_id → set of service_ids they currently occupy (pinned + chosen). */
function buildServiceIndex(work: WorkSlot[]): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  for (const slot of work) {
    for (const m of [...slot.pinned, ...slot.chosen]) {
      let set = idx.get(m);
      if (!set) idx.set(m, (set = new Set()));
      set.add(slot.service_id);
    }
  }
  return idx;
}

/** member_id → cumulative load (prior + assignments this run). */
function buildLoadIndex(work: WorkSlot[]): Map<string, number> {
  const load = new Map<string, number>();
  // Seed priors for every eligible member (so idle-but-eligible peers exist in
  // the gap calculation at their prior, not absent).
  for (const slot of work) {
    for (const c of slot.eligible) {
      if (!load.has(c.member_id)) load.set(c.member_id, c.prior);
    }
    for (const m of slot.pinned) {
      if (!load.has(m)) load.set(m, slot.priorOf.get(m) ?? 0);
    }
  }
  // Add one per current assignment (pinned + chosen).
  for (const slot of work) {
    for (const m of [...slot.pinned, ...slot.chosen]) {
      load.set(m, (load.get(m) ?? slot.priorOf.get(m) ?? 0) + 1);
    }
  }
  return load;
}

/** Every member who is eligible for at least one slot (the fairness universe). */
function buildEligibleUniverse(work: WorkSlot[]): string[] {
  const set = new Set<string>();
  for (const slot of work) {
    for (const c of slot.eligible) set.add(c.member_id);
    for (const m of slot.pinned) set.add(m); // pinned members are "in the window"
  }
  return [...set].sort();
}

// ── Move search & application ─────────────────────────────────────────────────

interface CandidateMove {
  slot: WorkSlot;
  out: string;
  in: string;
  fromLoadBefore: number;
  toLoadBefore: number;
  scoreDelta: number;
  gapBefore: number;
  gapAfter: number;
}

/**
 * Find the single best improving move across all slots, or null if none exists.
 * Deterministic: candidates are scanned in a fixed order and ties are broken by
 * (largest gap reduction, then largest load imbalance closed, then smallest
 * score cost, then service/role/member ids).
 */
function bestImprovingMove(
  work: WorkSlot[],
  servicesOf: Map<string, Set<string>>,
  load: Map<string, number>,
  universe: string[],
  epsilon: number,
): CandidateMove | null {
  const gapBefore = loadGap(universe, load);
  const ss2Before = sumSquares(universe, load);
  let best: CandidateMove | null = null;
  let bestKey: number[] | null = null;

  for (const slot of work) {
    for (const out of slot.chosen) {
      const outScore = slot.scoreOf.get(out)?.total ?? 0;
      const outLoad = load.get(out) ?? 0;
      // Try every other eligible candidate as the replacement.
      for (const cand of slot.eligible) {
        const inM = cand.member_id;
        if (inM === out) continue;
        if (slot.chosen.includes(inM) || slot.pinned.includes(inM)) continue; // already in slot
        // Double-book guard: `in` must not already serve this service elsewhere.
        if (servicesOf.get(inM)?.has(slot.service_id)) continue;
        // `in` must be genuinely eligible (it is — drawn from slot.eligible —
        // which is exactly the scored/available/non-gated set). A move never
        // lands a slot on an ineligible candidate.
        const inLoad = load.get(inM) ?? 0;

        // Score acceptance: total change is (in − out) for this slot.
        const scoreDelta = cand.score.total - outScore;
        if (scoreDelta < -epsilon) continue; // would cost too much fit

        // Simulate the load change and measure the new gap / spread.
        const nextLoad = simulateLoad(load, out, inM);
        const gapAfter = loadGap(universe, nextLoad);
        const ss2After = sumSquares(universe, nextLoad);

        const strictGapImprove = gapAfter < gapBefore;
        const paretoFlatten = gapAfter <= gapBefore && ss2After < ss2Before;
        if (!strictGapImprove && !paretoFlatten) continue;

        const move: CandidateMove = {
          slot,
          out,
          in: inM,
          fromLoadBefore: outLoad,
          toLoadBefore: inLoad,
          scoreDelta,
          gapBefore,
          gapAfter,
        };
        // Ranking key: prefer bigger gap reduction, then bigger spread
        // reduction, then smaller score cost, then stable ids.
        const key = [
          -(gapBefore - gapAfter), // larger reduction first (more negative)
          -(ss2Before - ss2After),
          -scoreDelta, // higher delta (less cost) first → more negative
        ];
        if (best === null || lexLess(key, bestKey!, move, best)) {
          best = move;
          bestKey = key;
        }
      }
    }
  }
  return best;
}

/** Lexicographic comparison with a final stable id tiebreak. */
function lexLess(ka: number[], kb: number[], ma: CandidateMove, mb: CandidateMove): boolean {
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return ka[i] < kb[i];
  }
  // Stable, deterministic final tiebreak on identifiers.
  const a = `${ma.slot.service_id}|${ma.slot.role_id}|${ma.out}|${ma.in}`;
  const b = `${mb.slot.service_id}|${mb.slot.role_id}|${mb.out}|${mb.in}`;
  return a < b;
}

function applyMove(
  servicesOf: Map<string, Set<string>>,
  load: Map<string, number>,
  move: CandidateMove,
): void {
  const slot = move.slot;
  // Swap chosen membership.
  const idx = slot.chosen.indexOf(move.out);
  if (idx >= 0) slot.chosen[idx] = move.in;
  // Update service index (out may still serve this service via another role —
  // recompute its membership for this service precisely).
  reindexServiceMembership(servicesOf, slot, move.out, move.in);
  // Update load.
  load.set(move.out, (load.get(move.out) ?? 0) - 1);
  load.set(move.in, (load.get(move.in) ?? 0) + 1);
}

/**
 * After moving `out`→`in` on a slot, `out` no longer occupies the slot but may
 * occupy `service_id` through another role; recompute precisely instead of
 * blindly deleting.
 */
function reindexServiceMembership(
  servicesOf: Map<string, Set<string>>,
  slot: WorkSlot,
  out: string,
  inM: string,
): void {
  // `in` now serves this service.
  let inSet = servicesOf.get(inM);
  if (!inSet) servicesOf.set(inM, (inSet = new Set()));
  inSet.add(slot.service_id);
  // `out`: still in this service iff pinned or chosen on it anywhere.
  const stillIn = slot.pinned.includes(out) || slot.chosen.includes(out);
  if (!stillIn) servicesOf.get(out)?.delete(slot.service_id);
}

function simulateLoad(load: Map<string, number>, out: string, inM: string): Map<string, number> {
  const next = new Map(load);
  next.set(out, (next.get(out) ?? 0) - 1);
  next.set(inM, (next.get(inM) ?? 0) + 1);
  return next;
}

// ── Metrics ───────────────────────────────────────────────────────────────────

function loadGap(universe: string[], load: Map<string, number>): number {
  if (universe.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const m of universe) {
    const v = load.get(m) ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
}

function sumSquares(universe: string[], load: Map<string, number>): number {
  let s = 0;
  for (const m of universe) {
    const v = load.get(m) ?? 0;
    s += v * v;
  }
  return s;
}

// ── Output assembly ─────────────────────────────────────────────────────────

function collectAssignments(work: WorkSlot[]): ProposedAssignment[] {
  const out: ProposedAssignment[] = [];
  for (const slot of work) {
    // Rank is the candidate's position in the slot's ranked eligible list (1-based);
    // pinned assignments aren't scored by the engine, so they don't appear here
    // (they're the planner's manual placements, surfaced elsewhere).
    for (const m of slot.chosen) {
      const score = slot.scoreOf.get(m);
      if (!score) continue;
      const rank = slot.eligible.findIndex((c) => c.member_id === m) + 1;
      out.push({
        service_id: slot.service_id,
        role_id: slot.role_id,
        member_id: m,
        rank: rank > 0 ? rank : 1,
        score,
      });
    }
  }
  return out;
}

function computeUnfilled(work: WorkSlot[]): UnfilledSlot[] {
  const out: UnfilledSlot[] = [];
  for (const slot of work) {
    const filled = slot.pinned.length + slot.chosen.length;
    if (filled < slot.quantity) {
      out.push({
        service_id: slot.service_id,
        role_id: slot.role_id,
        needed: slot.quantity,
        filled,
        reason: slot.eligible.length === 0 ? "no_eligible_candidates" : "insufficient_candidates",
      });
    }
  }
  return out;
}

function buildPerMember(
  universe: string[],
  work: WorkSlot[],
  load: Map<string, number>,
): MemberLoadLine[] {
  const priorOfMember = new Map<string, number>();
  for (const slot of work) {
    for (const c of slot.eligible) {
      if (!priorOfMember.has(c.member_id)) priorOfMember.set(c.member_id, c.prior);
    }
    for (const m of slot.pinned) {
      if (!priorOfMember.has(m)) priorOfMember.set(m, slot.priorOf.get(m) ?? 0);
    }
  }
  const lines = universe.map((m) => {
    const total = load.get(m) ?? 0;
    const prior = priorOfMember.get(m) ?? 0;
    return { member_id: m, prior, assigned: total - prior, load: total };
  });
  lines.sort((a, b) => b.load - a.load || (a.member_id < b.member_id ? -1 : a.member_id > b.member_id ? 1 : 0));
  return lines;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
