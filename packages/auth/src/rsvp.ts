/**
 * Magic-link RSVP — the no-account volunteer accept/decline loop (Phase 7).
 *
 * This module is the PURE core of Phase 7, layered on top of the magic-link JWT
 * in `magic-link.ts`. It owns three deterministic, well-tested pieces:
 *
 *   1. URL building   — `buildResponseLinks` turns an assignment + a signed
 *                       token into the per-recipient `accept_link`/`decline_link`
 *                       that the comms renderer interpolates (closing the gap
 *                       Phase 6 left open).
 *   2. Action parsing — `parseAction` validates the `?do=` query param.
 *   3. State machine  — `applyResponse` decides the next `assignment.status`
 *                       (+ whether a DB write is needed) given the current
 *                       status and the requested action. Idempotent and
 *                       change-of-mind aware, with no DB/clock dependency.
 *
 * The Next.js public route (apps/web/app/r/[token]) verifies the token with
 * `verifyMagicLink`, loads the assignment via the service-role client, and feeds
 * the current status here to compute the transition — keeping all branching
 * logic unit-testable and out of the request handler.
 */

import type { AssignmentStatus } from "@sundayplan/shared";

/** The actions a volunteer can take from a magic link. */
export type RsvpAction = "accept" | "decline";

export const RSVP_ACTIONS: readonly RsvpAction[] = ["accept", "decline"] as const;

/** Parse + validate the action carried in the link's query string. */
export function parseAction(raw: string | null | undefined): RsvpAction | null {
  if (raw === "accept" || raw === "decline") return raw;
  return null;
}

/**
 * Build the absolute accept/decline URLs for one recipient's token.
 *
 * The token already encodes member + assignment + purpose, so the URL only adds
 * the route path and the action. `baseUrl` is the deployment origin (no trailing
 * slash required); the assignment id is intentionally NOT in the path — it lives
 * inside the signed token so it can't be tampered with.
 */
export function buildResponseLinks(
  baseUrl: string,
  token: string,
): { accept_link: string; decline_link: string; view_link: string } {
  const origin = baseUrl.replace(/\/+$/, "");
  const enc = encodeURIComponent(token);
  return {
    view_link: `${origin}/r/${enc}`,
    accept_link: `${origin}/r/${enc}?do=accept`,
    decline_link: `${origin}/r/${enc}?do=decline`,
  };
}

/**
 * The outcome of applying an RSVP action to an assignment in a given state.
 *
 * - `next`     — the status the assignment should end in.
 * - `changed`  — whether `next` differs from the current status (i.e. a DB
 *                write is warranted). Idempotent re-taps return `changed: false`.
 * - `outcome`  — a UI-facing classification:
 *     `accepted` / `declined` — the volunteer's choice now stands.
 *     `unchanged`             — they re-confirmed the same answer (no-op).
 *     `closed`                — the slot is no longer respondable (removed).
 */
export interface ResponseResult {
  next: AssignmentStatus;
  changed: boolean;
  outcome: "accepted" | "declined" | "unchanged" | "closed";
}

/**
 * Statuses from which a volunteer may still respond. `removed` means the planner
 * pulled them off the rota — the link should show a friendly "no longer needed"
 * rather than silently flipping state back. Every other status (including an
 * already-accepted/declined one) allows a change of mind, which is the small,
 * simple policy window the spec asks for: the link stays live until it expires
 * or the planner removes the assignment.
 */
export function isRespondable(status: AssignmentStatus): boolean {
  return status !== "removed";
}

/**
 * Pure state transition for an accept/decline. No clock, no DB — the caller
 * persists `next` when `changed` is true.
 */
export function applyResponse(
  current: AssignmentStatus,
  action: RsvpAction,
): ResponseResult {
  if (!isRespondable(current)) {
    return { next: current, changed: false, outcome: "closed" };
  }

  const target: AssignmentStatus = action === "accept" ? "accepted" : "declined";

  if (current === target) {
    // Re-tapping the same choice — idempotent no-op, but still a valid view.
    return { next: target, changed: false, outcome: "unchanged" };
  }

  return {
    next: target,
    changed: true,
    outcome: action === "accept" ? "accepted" : "declined",
  };
}
