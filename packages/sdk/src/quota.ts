/**
 * Tier quota model — the enforcement half of `church.plan_tier`.
 *
 * Billing (Stripe) is deliberately deferred; this module is written so turning
 * payments on later only changes HOW `plan_tier` gets set, never how it is
 * enforced. The limits live here as the single source of truth, and the comms
 * send path consults `checkSmsQuota` BEFORE transmitting so a church can never
 * overrun its monthly SMS allowance.
 *
 * Pure: callers fetch `plan_tier` + `sms_quota_used` (+ reset timestamp) and
 * pass them in; the DB write-back of the new counter stays with the caller.
 */

/** Mirrors `schemas.ChurchPlanTier` — a test asserts the two stay in sync. */
export type PlanTier = "free" | "starter" | "growth" | "network";

export interface TierLimits {
  /** SMS segments per calendar month (email is unmetered on every tier). */
  smsSegmentsPerMonth: number;
  /** Max people (volunteers) in the church roster. */
  maxPeople: number;
}

/**
 * The published limits per tier. Email is free on all tiers (provider cost is
 * negligible); SMS is the metered resource. Numbers are launch defaults —
 * adjust here and every enforcement point follows.
 */
export const TIER_LIMITS: Record<PlanTier, TierLimits> = {
  free: { smsSegmentsPerMonth: 50, maxPeople: 50 },
  starter: { smsSegmentsPerMonth: 500, maxPeople: 150 },
  growth: { smsSegmentsPerMonth: 2000, maxPeople: 500 },
  network: { smsSegmentsPerMonth: 10000, maxPeople: 5000 },
};

export function limitsFor(tier: string | null | undefined): TierLimits {
  return TIER_LIMITS[(tier ?? "free") as PlanTier] ?? TIER_LIMITS.free;
}

export interface SmsQuotaState {
  tier: string | null | undefined;
  /** `church_settings.sms_quota_used` — segments used since the last reset. */
  used: number;
  /** `church_settings.sms_quota_used_at_reset` — when the counter last reset. */
  usedAtReset: Date | string;
  /** "Now" — injectable for tests. */
  now?: Date;
}

export interface SmsQuotaDecision {
  allowed: boolean;
  /** Segments remaining BEFORE this send (after an implicit month rollover). */
  remaining: number;
  /** The counter value the caller should persist if it proceeds with the send. */
  nextUsed: number;
  /** True when the month rolled over and the caller should also reset the timestamp. */
  shouldReset: boolean;
  /** Human-readable refusal, set when `allowed` is false. */
  reason?: string;
}

/** True when `a` and `b` fall in different UTC calendar months. */
function differentUtcMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() !== b.getUTCFullYear() || a.getUTCMonth() !== b.getUTCMonth();
}

/**
 * Decide whether a send of `segments` SMS segments fits the church's quota.
 * Handles the monthly rollover implicitly: if the reset timestamp is from a
 * previous UTC month, the counter is treated as 0 and `shouldReset` is set so
 * the caller persists the rollover.
 */
export function checkSmsQuota(state: SmsQuotaState, segments: number): SmsQuotaDecision {
  const limits = limitsFor(state.tier);
  const now = state.now ?? new Date();
  const resetAt = typeof state.usedAtReset === "string" ? new Date(state.usedAtReset) : state.usedAtReset;

  const rolledOver = differentUtcMonth(resetAt, now);
  const used = rolledOver ? 0 : Math.max(0, state.used);
  const remaining = Math.max(0, limits.smsSegmentsPerMonth - used);

  if (segments > remaining) {
    return {
      allowed: false,
      remaining,
      nextUsed: used,
      shouldReset: rolledOver,
      reason:
        `sms_quota_exceeded: ${remaining} of ${limits.smsSegmentsPerMonth} segments left this month ` +
        `on the ${(state.tier ?? "free").toString()} plan (send needs ${segments})`,
    };
  }

  return {
    allowed: true,
    remaining,
    nextUsed: used + segments,
    shouldReset: rolledOver,
  };
}

/** Whether the roster can grow to `peopleCount` members on this tier. */
export function checkPeopleLimit(tier: string | null | undefined, peopleCount: number): boolean {
  return peopleCount <= limitsFor(tier).maxPeople;
}
