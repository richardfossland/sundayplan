-- SundayPlan migration 0012 — church invite tokens (Phase 1.3)
--
-- Planners onboard co-planners (admin / planner / team_lead) by minting a signed
-- invite link tied to a church + a role, then copy-pasting it — no email/SMS
-- provider required. The recipient signs in / signs up, lands on the accept page
-- (/r/<token>/join), and a `church_member` row is created with the invited role.
--
-- These reuse the existing `magic_link` table (token_hash + single_use + expiry +
-- service-role-only RLS from 0002/0003), but differ from volunteer magic-links in
-- two ways:
--   • they are NOT member-scoped — the invitee has no `member` row yet, so
--     member_id must be allowed to be NULL;
--   • they carry the target church + the role to grant.
--
-- So we relax the member_id NOT NULL, extend the purpose check to include
-- 'church_invite', and add church_id + invite_role columns (only populated for
-- church_invite rows). A CHECK keeps the two shapes honest: a church_invite row
-- must have a church_id + invite_role and no member/assignment; every other
-- purpose keeps the original member-scoped shape.

-- Volunteer magic-links still require a member; only invites may omit it.
alter table public.magic_link
  alter column member_id drop not null;

alter table public.magic_link
  add column church_id   uuid references public.church(id) on delete cascade,
  add column invite_role text check (invite_role in ('admin','planner','team_lead'));

-- Extend the allowed purposes with 'church_invite'.
alter table public.magic_link
  drop constraint magic_link_purpose_check;
alter table public.magic_link
  add constraint magic_link_purpose_check
  check (purpose in ('assignment_response','availability_set','swap_request','generic','church_invite'));

-- Keep the two token shapes from drifting: an invite is church+role scoped with
-- no member/assignment; everything else is member-scoped.
alter table public.magic_link
  add constraint magic_link_shape_check check (
    case
      when purpose = 'church_invite'
        then church_id is not null
          and invite_role is not null
          and member_id is null
          and assignment_id is null
      else member_id is not null
          and church_id is null
          and invite_role is null
    end
  );

create index magic_link_church_invite_idx
  on public.magic_link (church_id)
  where purpose = 'church_invite' and used_at is null;

-- magic_link stays service-role-only (0003): invites are minted + redeemed by the
-- server-side admin client, never read directly from a client session.
