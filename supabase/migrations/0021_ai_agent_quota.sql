-- 0021 — Pastor's-chat AI agent quota counter.
--
-- The conversational planning agent calls Anthropic (a metered, paid resource),
-- so each church gets a monthly turn allowance enforced exactly like SMS
-- (`checkAiQuota` in packages/sdk/src/quota.ts). These two counters mirror
-- sms_quota_used / sms_quota_used_at_reset and roll over per UTC calendar month.
--
-- Additive + idempotent: existing rows default to 0 used, reset = now(), so a
-- church that never opens the chat panel is unaffected. RLS is unchanged
-- (church_settings already restricts read=member / write=planner).

alter table public.church_settings
  add column if not exists ai_agent_turns_used    int         not null default 0,
  add column if not exists ai_quota_used_at_reset  timestamptz not null default now();
