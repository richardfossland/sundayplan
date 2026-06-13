import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { sharedCookieOptions } from "./cookies";

const AUTH_PREFIXES = ["/sign-in", "/sign-up"];

/**
 * Routes reachable WITHOUT a planner account. `/auth/callback` is the OAuth
 * landing (session cookie isn't set until the handler exchanges the code).
 * Phase 3 adds the no-account renter surfaces:
 *   - `/api/public/*`  — slug-scoped public API (rentals + slots)
 *   - `/r/`            — renter status page (magic-link token IS the auth)
 *   - `/leie/`         — public rental landing scoped by church slug
 * Each enforces its own church-scoping server-side (verified slug / token); the
 * middleware just declines to redirect them to /sign-in. Keep this list tight.
 */
const PUBLIC_PREFIXES = ["/auth/callback", "/api/public", "/r/", "/leie/"];

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
          for (const { name, value, options } of cookiesToSet)
            response.cookies.set(name, value, options);
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isAuthRoute = AUTH_PREFIXES.some((p) => path.startsWith(p));
  const isPublicRoute = PUBLIC_PREFIXES.some((p) => path.startsWith(p));

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
