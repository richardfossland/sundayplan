-- SundayPlan migration 0011 — volunteer self-service + credential gating
--
-- Adds the two tables behind the competitive differentiators from the redesign:
--   • swap_request     — a volunteer who can't make it finds their own cover
--                        (GraceSquad/PC "find your replacement"), or leaves it
--                        open for the planner. The ranking brain lives in the
--                        SDK (`eligibleReplacements` in swap.ts); this is just
--                        durable state.
--   • member_credential — background-check / certification tracking. Auto-fill
--                        skips a member whose required credential isn't current
--                        (GraceSquad gating). Status is read by the SDK gate.
--
-- magic_link.purpose already allows 'swap_request' and 'availability_set'
-- (0002), so the volunteer self-service links need no enum change.
--
-- RLS mirrors the established split: planners get full access via is_planner_of()
-- (0001); volunteers act on their own rows via volunteer_member_id() (0003).
-- As with assignment responses, WHICH columns a volunteer may change is enforced
-- by the service-role action/Edge layer, not the policy.

-- ── swap_request ─────────────────────────────────────────────────────────────
create table public.swap_request (
  id                      uuid primary key default gen_random_uuid(),
  church_id               uuid not null references public.church(id) on delete cascade,
  assignment_id           uuid not null references public.assignment(id) on delete cascade,
  requested_by_member_id  uuid not null references public.member(id) on delete cascade,
  status                  text not null default 'open'
                            check (status in ('open','claimed','cancelled','resolved')),
  claimed_by_member_id    uuid references public.member(id) on delete set null,
  note                    text,
  created_at              timestamptz not null default now(),
  resolved_at             timestamptz
);

create index swap_request_church_idx     on public.swap_request (church_id);
create index swap_request_assignment_idx on public.swap_request (assignment_id);
create index swap_request_open_idx       on public.swap_request (church_id) where status = 'open';

alter table public.swap_request enable row level security;

-- Planners manage every swap in their church.
create policy swap_planner_all on public.swap_request
  for all using (is_planner_of(swap_request.church_id))
  with check (is_planner_of(swap_request.church_id));

-- The requesting volunteer reads/cancels their own swap.
create policy swap_requester_rw on public.swap_request
  for all using (requested_by_member_id = public.volunteer_member_id());

-- Any volunteer in the same church may see OPEN swaps (to offer cover). Their
-- church comes from their own member row.
create policy swap_volunteer_browse on public.swap_request
  for select using (
    status = 'open'
    and church_id = (
      select m.church_id from public.member m where m.id = public.volunteer_member_id()
    )
  );

-- …and claim one (set claimed_by/status). Column safety is enforced server-side.
create policy swap_volunteer_claim on public.swap_request
  for update using (
    church_id = (
      select m.church_id from public.member m where m.id = public.volunteer_member_id()
    )
  );

-- ── member_credential ────────────────────────────────────────────────────────
create table public.member_credential (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.church(id) on delete cascade,
  member_id   uuid not null references public.member(id) on delete cascade,
  kind        text not null
                check (kind in ('background_check','cpr','first_aid','safeguarding','drivers_license','other')),
  status      text not null default 'none'
                check (status in ('current','pending','expired','none')),
  issued_at   date,
  expires_at  date,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (member_id, kind)
);

create index member_credential_member_idx on public.member_credential (member_id);

alter table public.member_credential enable row level security;

-- Planners manage credentials for their church.
create policy member_credential_planner_all on public.member_credential
  for all using (is_planner_of(member_credential.church_id))
  with check (is_planner_of(member_credential.church_id));

-- A volunteer may read their own credential status.
create policy member_credential_volunteer_read on public.member_credential
  for select using (member_id = public.volunteer_member_id());

create trigger member_credential_set_updated_at
  before update on public.member_credential
  for each row execute function set_updated_at();
