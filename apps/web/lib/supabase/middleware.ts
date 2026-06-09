import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { sharedCookieOptions } from "./cookies";

const AUTH_PREFIXES = ["/sign-in", "/sign-up"];

/**
 * Public routes reachable WITHOUT a planner account. The magic-link volunteer
 * response page (`/r/<token>`) is the no-account RSVP surface (Phase 7): the
 * signed token IS the auth, so the planner-session gate must not redirect it to
 * sign-in. `/auth/callback` is the OAuth landing (Phase 1.3): the session cookie
 * isn't set until that handler exchanges the code, so it must pass through
 * un-gated. Keep this list tight.
 */
const PUBLIC_PREFIXES = ["/r/", "/auth/callback"];

/** Refresh the session cookie and gate app routes behind auth. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: sharedCookieOptions(),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isAuthRoute = AUTH_PREFIXES.some((p) => path.startsWith(p));
  const isPublicRoute = PUBLIC_PREFIXES.some((p) => path.startsWith(p));

  // Public (no-account) routes are always allowed through.
  if (isPublicRoute) return response;

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}
