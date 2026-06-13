/**
 * OAuth callback — `/auth/callback`. Exchanges the `?code=` for a session
 * (sets the SSR auth cookies) and forwards to the app root. Allowlisted in
 * middleware so the in-flight callback isn't bounced to sign-in. Mirrors the
 * SundayPlan callback, minus the church-creation flow (booking never creates a
 * church — that's SundayPlan's onboarding).
 */
import { NextResponse, type NextRequest } from "next/server";
import { schemas } from "@sundayplan/shared";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function redirectWithError(origin: string, code: string | null): NextResponse {
  const url = new URL("/sign-in", origin);
  if (code) url.searchParams.set("error", code);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;

  const providerError = searchParams.get("error_code") ?? searchParams.get("error");
  if (providerError) return redirectWithError(origin, providerError);

  const code = searchParams.get("code");
  if (!code) return redirectWithError(origin, "missing_code");

  const next = schemas.sanitizeNextPath(searchParams.get("next"));

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return redirectWithError(origin, "exchange_failed");

  return NextResponse.redirect(new URL(next, origin));
}
