-- SundayPlan migration 0002 — core domain
-- Members, teams, services, assignments, etc. Each gets RLS policies that
-- defer to the helpers from 0001 (is_member_of, is_planner_of).
--
-- Volunteer magic-link access uses a separate auth path with a JWT claim
-- `volunteer_member_id`. Policies for that path are added in 0003 once
-- the JWT plumbing is wired.

-- ── ChurchSettings (1:1) ────────────────────────────────────────────────────
create table public.church_settings (
  church_id                          uuid primary key references public.church(id) on delete cascade,
  ccli_license_number                text,
  ccli_size_category                 text check (ccli_size_category in ('A','B','C','D','E','F') or ccli_size_category is null),
  ccli_streaming_addon               boolean not null default false,
  tono_license_status                text default 'none' check (tono_license_status in ('none','state_church_blanket','direct_agreement','application_pending','not_applicable')),
  tono_customer_id                   text,
  tono_streaming_addon               boolean not null default false,
  default_max_assignments_per_month  int  not null default 2,
  reminder_cadence                   jsonb not null default '{"days_before":[7,3,1],"hours_before":[1]}'::jsonb,
  sms_quota_used                     int  not null default 0,
  sms_quota_used_at_reset            timestamptz not null default now(),
  auto_buy_sms_overage               boolean not null default false,
  sundaystage_connected              boolean not null default false,
  sundayrec_connected                boolean not null default false,
  sundaysong_connected               boolean not null default false,
  updated_at                         timestamptz not null default now()
);

alter table public.church_settings enable row level security;
create policy church_settings_read   on public.church_settings for select using (is_member_of(church_id));
create policy church_settings_write  on public.church_settings for update using (is_planner_of(church_id));
create trigger set_updated_at_church_settings before update on public.church_settings
  for each row execute function public.set_updated_at();

-- ── Member ──────────────────────────────────────────────────────────────────
create table public.member (
  id                       uuid primary key default gen_random_uuid(),
  church_id                uuid not null references public.church(id) on delete cascade,
  display_name             text not null,
  phone_e164               text,
  email                    text,
  user_id                  uuid references auth.users(id),
  language                 text not null default 'no',
  preferred_channel        text not null default 'sms' check (preferred_channel in ('sms','email','push')),
  birthday                 date,
  joined_at                date,
  status                   text not null default 'active' check (status in ('active','inactive','archived')),
  notes                    text,
  tags                     text[] not null default '{}',
  target_serves_per_month  int,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  archived_at              timestamptz
);
create index member_church_idx          on public.member (church_id) where archived_at is null;
create index member_church_status_idx   on public.member (church_id, status);
create unique index member_phone_uniq   on public.member (church_id, phone_e164) where phone_e164 is not null;

alter table public.member enable row level security;
create policy member_read         on public.member for select using (is_member_of(church_id));
create policy member_planner_all  on public.member for all     using (is_planner_of(church_id));
create trigger set_updated_at_member before update on public.member
  for each row execute function public.set_updated_at();

-- ── Team ────────────────────────────────────────────────────────────────────
create table public.team (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.church(id) on delete cascade,
  name        text not null,
  color       text,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (church_id, name)
);
create index team_church_idx on public.team (church_id);

alter table public.team enable row level security;
create policy team_read         on public.team for select using (is_member_of(church_id));
create policy team_planner_all  on public.team for all     using (is_planner_of(church_id));
create trigger set_updated_at_team before update on public.team for each row execute function public.set_updated_at();

-- ── Role (within Team) ──────────────────────────────────────────────────────
create table public.role (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.team(id) on delete cascade,
  name        text not null,
  description text,
  unique (team_id, name)
);
create index role_team_idx on public.role (team_id);

alter table public.role enable row level security;
create policy role_read on public.role for select
  using (exists (select 1 from public.team t where t.id = team_id and is_member_of(t.church_id)));
create policy role_planner_all on public.role for all
  using (exists (select 1 from public.team t where t.id = team_id and is_planner_of(t.church_id)));

-- ── TeamMembership ──────────────────────────────────────────────────────────
create table public.team_membership (
  member_id    uuid not null references public.member(id) on delete cascade,
  team_id      uuid not null references public.team(id)   on delete cascade,
  role_id      uuid not null references public.role(id)   on delete cascade,
  skill_level  text not null default 'capable' check (skill_level in ('training','capable','lead','trainer')),
  notes        text,
  primary key (member_id, team_id, role_id)
);
create index team_membership_team_idx   on public.team_membership (team_id);

alter table public.team_membership enable row level security;
create policy team_membership_read on public.team_membership for select
  using (exists (select 1 from public.team t where t.id = team_id and is_member_of(t.church_id)));
create policy team_membership_planner_all on public.team_membership for all
  using (exists (select 1 from public.team t where t.id = team_id and is_planner_of(t.church_id)));

-- ── Availability ────────────────────────────────────────────────────────────
create table public.availability (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.member(id) on delete cascade,
  kind        text not null check (kind in ('recurring','range','specific')),
  pattern     jsonb not null,
  reason      text,
  reason_visibility text not null default 'planner' check (reason_visibility in ('private','planner','team')),
  created_at  timestamptz not null default now()
);
create index availability_member_idx on public.availability (member_id);

alter table public.availability enable row level security;
create policy availability_read on public.availability for select
  using (exists (select 1 from public.member m where m.id = member_id and is_member_of(m.church_id)));
create policy availability_member_or_planner on public.availability for all
  using (exists (select 1 from public.member m where m.id = member_id and (m.user_id = auth.uid() or is_planner_of(m.church_id))));

-- ── ServiceTemplate ─────────────────────────────────────────────────────────
create table public.service_template (
  id                    uuid primary key default gen_random_uuid(),
  church_id             uuid not null references public.church(id) on delete cascade,
  name                  text not null,
  default_duration_min  int not null default 75,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (church_id, name)
);

alter table public.service_template enable row level security;
create policy svctmpl_read        on public.service_template for select using (is_member_of(church_id));
create policy svctmpl_planner_all on public.service_template for all     using (is_planner_of(church_id));
create trigger set_updated_at_svctmpl before update on public.service_template for each row execute function public.set_updated_at();

create table public.template_item (
  template_id  uuid not null references public.service_template(id) on delete cascade,
  position     int not null,
  label        text not null,
  kind         text not null check (kind in ('welcome','worship_set','scripture','sermon','response','closing','announcement','gap')),
  duration_min int not null default 0,
  primary key (template_id, position)
);

create table public.service_team_requirement (
  template_id  uuid not null references public.service_template(id) on delete cascade,
  role_id      uuid not null references public.role(id) on delete cascade,
  quantity     int not null default 1,
  primary key (template_id, role_id)
);

-- ── Service ─────────────────────────────────────────────────────────────────
create table public.service (
  id              uuid primary key default gen_random_uuid(),
  church_id       uuid not null references public.church(id) on delete cascade,
  template_id     uuid references public.service_template(id),
  name            text not null,
  starts_at_utc   timestamptz not null,
  notes           text,
  state           text not null default 'draft' check (state in ('draft','published','in_progress','played','archived')),
  was_streamed_flag boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index service_church_date_idx on public.service (church_id, starts_at_utc);
create index service_state_idx       on public.service (church_id, state);

alter table public.service enable row level security;
create policy service_read        on public.service for select using (is_member_of(church_id));
create policy service_planner_all on public.service for all     using (is_planner_of(church_id));
create trigger set_updated_at_service before update on public.service for each row execute function public.set_updated_at();

create table public.service_item (
  id             uuid primary key default gen_random_uuid(),
  service_id     uuid not null references public.service(id) on delete cascade,
  position       int not null,
  label          text not null,
  kind           text not null check (kind in ('welcome','song','scripture','sermon','announcement','gap')),
  duration_min   int not null default 0,
  notes          text,
  song_id        uuid,
  scripture_ref  text,
  unique (service_id, position)
);

-- ── Song ────────────────────────────────────────────────────────────────────
create table public.song (
  id              uuid primary key default gen_random_uuid(),
  church_id       uuid not null references public.church(id) on delete cascade,
  title           text not null,
  author          text,
  ccli_song_id    text,
  tono_work_id    text,
  default_key     text,
  tempo_bpm       int,
  language        text not null default 'no',
  themes          text[] not null default '{}',
  last_used_at    timestamptz,
  sundaysong_id   uuid,
  chord_chart_url text,
  demo_url        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index song_church_idx       on public.song (church_id);
create index song_church_used_idx  on public.song (church_id, last_used_at);

alter table public.song enable row level security;
create policy song_read        on public.song for select using (is_member_of(church_id));
create policy song_planner_all  on public.song for all     using (is_planner_of(church_id));
create trigger set_updated_at_song before update on public.song for each row execute function public.set_updated_at();

-- ── Setlist (one per service) ───────────────────────────────────────────────
create table public.setlist (
  id          uuid primary key default gen_random_uuid(),
  service_id  uuid not null unique references public.service(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.setlist_song (
  setlist_id    uuid not null references public.setlist(id) on delete cascade,
  position      int not null,
  song_id       uuid not null references public.song(id),
  key_override  text,
  notes         text,
  primary key (setlist_id, position)
);

-- ── Assignment ──────────────────────────────────────────────────────────────
create table public.assignment (
  id               uuid primary key default gen_random_uuid(),
  church_id        uuid not null references public.church(id) on delete cascade, -- denormalized for RLS
  service_id       uuid not null references public.service(id) on delete cascade,
  role_id          uuid not null references public.role(id),
  member_id        uuid not null references public.member(id),
  service_item_id  uuid references public.service_item(id),
  status           text not null default 'pending' check (status in ('pending','invited','accepted','declined','no_response','removed')),
  score            numeric,
  score_breakdown  jsonb,
  invited_at       timestamptz,
  responded_at     timestamptz,
  next_reminder_at timestamptz,
  created_by       text not null default 'planner' check (created_by in ('planner','auto_fill','swap')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (service_id, role_id, member_id)
);
create index assignment_service_idx     on public.assignment (service_id);
create index assignment_member_idx      on public.assignment (member_id);
create index assignment_reminder_idx    on public.assignment (next_reminder_at) where status in ('invited','accepted') and next_reminder_at is not null;

alter table public.assignment enable row level security;
create policy assignment_read         on public.assignment for select using (is_member_of(church_id));
create policy assignment_planner_all  on public.assignment for all     using (is_planner_of(church_id));
create trigger set_updated_at_assignment before update on public.assignment for each row execute function public.set_updated_at();

-- ── MagicLink ───────────────────────────────────────────────────────────────
create table public.magic_link (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.member(id) on delete cascade,
  purpose         text not null check (purpose in ('assignment_response','availability_set','swap_request','generic')),
  assignment_id   uuid references public.assignment(id),
  token_hash      text not null unique,  -- sha-256 of the signed JWT we sent
  single_use      boolean not null default true,
  used_at         timestamptz,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now()
);
create index magic_link_member_idx     on public.magic_link (member_id);
create index magic_link_expires_idx    on public.magic_link (expires_at) where used_at is null;

-- magic_link is service-role-only — never accessed directly from clients

-- ── Comms logs ──────────────────────────────────────────────────────────────
create table public.sms_log (
  id                  uuid primary key default gen_random_uuid(),
  church_id           uuid not null references public.church(id) on delete cascade,
  member_id           uuid references public.member(id),
  provider            text not null,
  template_id         text,
  to_recipient        text not null,
  body_hash           text,  -- GDPR — store hash not plaintext for log retention
  status              text not null default 'queued' check (status in ('queued','sent','delivered','failed','bounced')),
  cost_cents          int,
  provider_message_id text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now()
);
create index sms_log_church_date_idx on public.sms_log (church_id, created_at);

alter table public.sms_log enable row level security;
create policy sms_log_planner on public.sms_log for select using (is_planner_of(church_id));

create table public.email_log (
  id                  uuid primary key default gen_random_uuid(),
  church_id           uuid not null references public.church(id) on delete cascade,
  member_id           uuid references public.member(id),
  provider            text not null,
  template_id         text,
  to_recipient        text not null,
  subject             text,
  status              text not null default 'queued' check (status in ('queued','sent','delivered','failed','bounced','complained')),
  provider_message_id text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now()
);
create index email_log_church_date_idx on public.email_log (church_id, created_at);

alter table public.email_log enable row level security;
create policy email_log_planner on public.email_log for select using (is_planner_of(church_id));
