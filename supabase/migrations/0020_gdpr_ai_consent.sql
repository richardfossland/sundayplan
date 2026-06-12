-- 0020 — GDPR self-service: explicit church-level consent for cloud AI.
--
-- The suite's privacy posture is local-first with cloud AI strictly opt-in.
-- This flag is that opt-in, controlled by planners in Settings; every
-- Anthropic-backed feature (auto-fill rationale refiner, setlist AI) must
-- check it before sending ANY church data off-machine. Default off.

alter table public.church_settings
  add column if not exists ai_consent boolean not null default false;
