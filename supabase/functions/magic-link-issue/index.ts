// Magic-link issuance — a planner mints a link for a member/assignment.
// Authorized either by the service-role key (server-to-server) or a planner
// session (admin/planner church_member of the target church). We do the auth
// check ourselves, so verify_jwt = false. The raw token is returned to the
// caller; only its SHA-256 hash is stored (single-use bookkeeping).

import { createClient } from "jsr:@supabase/supabase-js@2";
// Direct .ts import (Deno needs the extension; the package barrel uses
// extensionless re-exports that only the bundler/Node side resolves).
import { signMagicLink, tokenHash } from "../../../packages/auth/src/magic-link.ts";
import type { MagicLinkPurpose } from "@sundayplan/shared";

const MAGICLINK_SECRET = Deno.env.get("MAGICLINK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const DEFAULT_TTL = 60 * 60 * 24 * 7; // 7 days

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const bearer = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";

  let payload: {
    member_id?: string;
    church_id?: string;
    purpose?: MagicLinkPurpose;
    assignment_id?: string;
    ttl_seconds?: number;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const { member_id, church_id, assignment_id } = payload;
  const purpose: MagicLinkPurpose = payload.purpose ?? "assignment_response";
  const ttl_seconds = payload.ttl_seconds ?? DEFAULT_TTL;
  if (!member_id || !church_id) return json({ error: "bad_request" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Authorize: service-role bearer, or a planner of the church.
  let authorized = bearer === SERVICE_ROLE;
  if (!authorized && bearer) {
    const asCaller = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await asCaller.auth.getUser();
    if (user) {
      const { data: membership } = await db
        .from("church_member")
        .select("role")
        .eq("church_id", church_id)
        .eq("user_id", user.id)
        .maybeSingle();
      authorized = !!membership && (membership.role === "admin" || membership.role === "planner");
    }
  }
  if (!authorized) return json({ error: "forbidden" }, 403);

  // The member must belong to the church.
  const { data: member } = await db
    .from("member")
    .select("id")
    .eq("id", member_id)
    .eq("church_id", church_id)
    .maybeSingle();
  if (!member) return json({ error: "member_not_found" }, 404);

  const token = await signMagicLink({ member_id, church_id, purpose, assignment_id, ttl_seconds }, MAGICLINK_SECRET);
  const hash = await tokenHash(token);
  const expires_at = new Date(Date.now() + ttl_seconds * 1000).toISOString();

  const { error: insertError } = await db.from("magic_link").insert({
    member_id,
    purpose,
    assignment_id: assignment_id ?? null,
    token_hash: hash,
    expires_at,
  });
  if (insertError) return json({ error: "insert_failed", detail: insertError.message }, 500);

  return json({ token, expires_at });
});
