/**
 * Church-invite acceptance (Phase 1.3) — server action.
 *
 * Mirrors the volunteer RSVP action pattern: the public `/r/<token>/join` page
 * verifies the token + loads context, and this action performs the one mutation
 * — creating a `church_member` for the signed-in user with the invited role.
 *
 * The signed invite token IS the authorization for the role/church; the only
 * extra requirement is a Supabase session for the invitee (so we have a user_id
 * to attach the membership to). `redeemChurchInvite` handles single-use + the
 * "already a member" idempotent case; we keep this thin so the branching stays
 * unit-tested in the data layer.
 */
"use server";

import { redeemChurchInvite, type RedeemOutcome } from "@/lib/data/invites";

export async function joinChurch(token: string): Promise<RedeemOutcome> {
  return redeemChurchInvite(token);
}
