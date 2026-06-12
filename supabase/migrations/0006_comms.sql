-- ════════════════════════════════════════════════════════════════════════════
-- 0006_comms.sql — Communications infrastructure (Phase 6)
--
-- Three tables, all church-scoped via the is_member_of() helper from 0001:
--   message_template — planner-authored, reusable templates (sms/email/push)
--   message          — one outbound send (optionally tied to a service)
--   message_delivery — one row per recipient with its lifecycle status
--
-- Bodies are NOT stored in plaintext on deliveries (GDPR): we keep body_hash.
-- The composed message keeps its rendered body for the planner's audit/history,
-- consistent with how SmsLog already worked.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Message templates ─────────────────────────────────────────────────────────
create table message_template (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references church(id) on delete cascade,
  name text not null,
  channel text not null check (channel in ('sms','email','push')),
  purpose text not null default 'custom'
    check (purpose in ('invite','reminder','final_reminder','confirmation','cancellation','custom')),
  language text not null default 'no',
  subject text,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Composed outbound messages ───────────────────────────────────────────────
create table message (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references church(id) on delete cascade,
  template_id uuid references message_template(id) on delete set null,
  service_id uuid references service(id) on delete set null,
  channel text not null check (channel in ('sms','email','push')),
  purpose text not null default 'custom'
    check (purpose in ('invite','reminder','final_reminder','confirmation','cancellation','custom')),
  subject text,
  body text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ── Per-recipient deliveries ──────────────────────────────────────────────────
create table message_delivery (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references message(id) on delete cascade,
  church_id uuid not null references church(id) on delete cascade,
  member_id uuid references member(id) on delete set null,
  channel text not null check (channel in ('sms','email','push')),
  to_recipient text not null,
  body_hash text,
  status text not null default 'queued'
    check (status in ('queued','sent','delivered','failed','skipped')),
  skip_reason text,
  provider text,
  provider_message_id text,
  cost_cents int,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index message_service_idx on message (service_id);
create index message_delivery_message_idx on message_delivery (message_id);
create index message_delivery_member_idx on message_delivery (member_id);

-- ── updated_at trigger (reuses set_updated_at() from 0002) ─────────────────────
create trigger message_template_updated_at before update on message_template
  for each row execute function set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table message_template enable row level security;
alter table message enable row level security;
alter table message_delivery enable row level security;

-- message_template: church members manage their church's templates
create policy message_template_rw on message_template
  for all using (is_member_of(message_template.church_id))
  with check (is_member_of(message_template.church_id));

-- message: church members manage their church's messages
create policy message_rw on message
  for all using (is_member_of(message.church_id))
  with check (is_member_of(message.church_id));

-- message_delivery: church members manage their church's deliveries
create policy message_delivery_rw on message_delivery
  for all using (is_member_of(message_delivery.church_id))
  with check (is_member_of(message_delivery.church_id));

-- Phase 7 seam: a magic-link volunteer may read deliveries addressed to them,
-- mirroring the assignment_volunteer_select policy in 0003.
create policy message_delivery_volunteer_select on message_delivery
  for select using (member_id = volunteer_member_id());
