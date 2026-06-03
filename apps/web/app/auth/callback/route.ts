/**
 * OAuth callback (Phase 1.3) — `/auth/callback`.
 *
 * Supabase's hosted OAuth flow bounces the browser here with a `?code=` after
 * the provider (GitHub / Google / Apple) authenticates the planner. We exchange
 * that code for a session (which sets the auth cookies via the SSR client) and
 * then forward to the `next` path. Landing on `/` lets the `(app)` layout decide
 * between onboarding (no church yet) and the dashboard — so OAuth sign-ups flow
 * straight into church creation + `church_member` placement under RLS, exactly
 * like email sign-ups.
 *
 * This route lives outside the `(app)` group and is allowlisted in middleware so
 * the planner-session gate doesn't redirect the in-flight callback to sign-in.
 */
import { NextResponse, type NextRequest } from "next/server";
import { schemas } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Bounce back to sign-up carrying a provider error message. */
function redirectWithError(origin: string, code: string | null): NextResponse {
  const url = new URL("/sign-up", origin);
  if (code) url.searchParams.set("error", code);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;

  // Provider-side failure (user denied, email unverified, provider down …).
  const providerError = searchParams.get("error_code") ?? searchParams.get("error");
  if (providerError) {
    return redirectWithError(origin, providerError);
  }

  const code = searchParams.get("code");
  if (!code) {
    return redirectWithError(origin, "missing_code");
  }

  const next = schemas.sanitizeNextPath(searchParams.get("next"));

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return redirectWithError(origin, "exchange_failed");
  }

  // A planner account must reach a verified email before it can own a church.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const identity = user?.identities?.[0] as
    | { email?: string | null; identity_data?: { email_verified?: boolean | null } | null }
    | undefined;
  const emailVerified = schemas.isEmailVerifiedIdentity({
    email: user?.email ?? identity?.email ?? null,
    email_verified: identity?.identity_data?.email_verified ?? null,
  });
  if (!emailVerified) {
    // Sign the half-finished session back out so they don't sit in a broken
    // half-authenticated state, then explain why.
    await supabase.auth.signOut();
    return redirectWithError(origin, "provider_email_needs_verification");
  }

  return NextResponse.redirect(new URL(next, origin));
}
