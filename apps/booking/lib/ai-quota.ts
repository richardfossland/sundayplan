/**
 * Pure per-church AI quota — the enforcement half of the cloud-AI opt-in.
 *
 * Mirrors the SDK's `checkSmsQuota` model (packages/sdk/src/quota.ts): a monthly
 * counter with implicit UTC-month rollover, decided purely so it can be unit
 * tested without a DB. The NL-booking route consults `checkAiQuota` BEFORE
 * calling Claude so a church can never overrun its monthly AI-parse allowance.
 *
 * Limits are tier-scoped and keyed to `church.plan_tier`. Numbers are launch
 * defaults; adjust here and every enforcement point follows. The counter +
 * reset timestamp live on `public.church_settings` (migration 0023):
 *   ai_quota_used, ai_quota_used_at_reset.
 */

export type PlanTier = "free" | "starter" | "growth" | "network";

/** AI parse calls allowed per calendar month, per tier. */
export const AI_PARSES_PER_MONTH: Record<PlanTier, number> = {
  free: 20,
  starter: 200,
  growth: 1000,
  network: 5000,
};

export function aiLimitFor(tier: string | null | undefined): number {
  return AI_PARSES_PER_MONTH[(tier ?? "free") as PlanTier] ?? AI_PARSES_PER_MONTH.free;
}

export interface AiQuotaState {
  tier: string | null | undefined;
  /** `church_settings.ai_quota_used` since the last reset. */
  used: number;
  /** `church_settings.ai_quota_used_at_reset`. */
  usedAtReset: Date | string;
  now?: Date;
}

export interface AiQuotaDecision {
  allowed: boolean;
  /** Calls remaining BEFORE this one (after an implicit month rollover). */
  remaining: number;
  /** Counter value the caller should persist if it proceeds. */
  nextUsed: number;
  /** True when the month rolled over — caller also resets the timestamp. */
  shouldReset: boolean;
  reason?: string;
}

function differentUtcMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() !== b.getUTCFullYear() || a.getUTCMonth() !== b.getUTCMonth();
}

/**
 * Decide whether ONE AI parse fits the church's monthly quota. Handles the
 * monthly rollover implicitly: a reset timestamp from a previous UTC month
 * treats the counter as 0 and sets `shouldReset`.
 */
export function checkAiQuota(state: AiQuotaState): AiQuotaDecision {
  const limit = aiLimitFor(state.tier);
  const now = state.now ?? new Date();
  const resetAt =
    typeof state.usedAtReset === "string" ? new Date(state.usedAtReset) : state.usedAtReset;

  const rolledOver = differentUtcMonth(resetAt, now);
  const used = rolledOver ? 0 : Math.max(0, state.used);
  const remaining = Math.max(0, limit - used);

  if (remaining < 1) {
    return {
      allowed: false,
      remaining,
      nextUsed: used,
      shouldReset: rolledOver,
      reason:
        `ai_quota_exceeded: 0 of ${limit} AI-parses left this month on the ` +
        `${(state.tier ?? "free").toString()} plan`,
    };
  }

  return { allowed: true, remaining, nextUsed: used + 1, shouldReset: rolledOver };
}
