// Volunteer magic-link response — the no-account RSVP endpoint.
// Public (verify_jwt = false): the signed magic-link token IS the auth. We
// verify the token, enforce single-use via magic_link.token_hash, then perform
// the RSVP with the service-role client. No Supabase session for the volunteer.

import { createClient } from "jsr:@supabase/supabase-js@2";
// Direct .ts import (Deno needs the extension; the package barrel uses
// extensionless re-exports that only the bundler/Node side resolves).
import { tokenHash, verifyMagicLink } from "../../../packages/auth/src/magic-link.ts";
import { consumeSingleUseLink } from "../../../packages/auth/src/rsvp.ts";

const MAGICLINK_SECRET = Deno.env.get("MAGICLINK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let payload: { token?: string; action?: string; reason?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const { token, action } = payload;
  if (!token || (action !== "accept" && action !== "decline")) {
    return json({ error: "bad_request" }, 400);
  }

  const verified = await verifyMagicLink(token, MAGICLINK_SECRET);
  if (!verified.ok) return json({ error: verified.reason }, 401);

  const claims = verified.claims;
  if (claims.purpose !== "assignment_response" || !claims.assignment_id) {
    return json({ error: "wrong_purpose" }, 403);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const hash = await tokenHash(token);

  // Single-use: the row must exist, be unused, and not expired.
  const { data: link } = await db
    .from("magic_link")
    .select("used_at, expires_at")
    .eq("token_hash", hash)
    .maybeSingle();

  if (!link) return json({ error: "unknown_token" }, 401);
  if (link.used_at) return json({ error: "already_used" }, 409);
  if (new Date(link.expires_at).getTime() < Date.now()) return json({ error: "expired" }, 401);

  // Claim the single-use link ATOMICALLY before touching the assignment. The
  // condition `used_at IS NULL` is evaluated inside the UPDATE, so concurrent
  // POSTs race in the database: exactly one wins and proceeds to the RSVP
  // write; the loser is rejected here rather than both flipping the status
  // (last-writer-wins). Closes the read-check-write TOCTOU; mirrors the web
  // server action in apps/web/app/r/[token]/actions.ts.
  const consumed = await consumeSingleUseLink(db, hash);
  if (!consumed.ok) {
    if (consumed.reason === "already_used") return json({ error: "already_used" }, 409);
    return json({ error: "consume_failed", detail: consumed.detail }, 500);
  }

  const status = action === "accept" ? "accepted" : "declined";
  const { error: updateError } = await db
    .from("assignment")
    .update({ status, responded_at: new Date().toISOString() })
    .eq("id", claims.assignment_id)
    .eq("member_id", claims.member_id);
  if (updateError) return json({ error: "update_failed", detail: updateError.message }, 500);

  return json({ ok: true, status });
});
