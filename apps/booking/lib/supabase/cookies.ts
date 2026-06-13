import type { CookieOptions } from "@supabase/ssr";

/**
 * Shared cookie options for every Supabase client (browser, server, middleware)
 * so the session cookie is written identically everywhere.
 *
 * Cross-subdomain SSO: when `NEXT_PUBLIC_COOKIE_DOMAIN` is set (e.g.
 * `.sundaysuite.app` in production), the session cookie is scoped to the parent
 * domain so every Sunday web app on a subdomain (`plan.`, `booking.`, …) shares
 * one login — sign in on one, you're signed in on all. The default
 * `@supabase/ssr` behaviour stores the session per-origin, which does NOT share
 * across subdomains, so this is the one bit that makes web↔web SSO work.
 *
 * Left UNSET in local dev (localhost has no parent domain to share to).
 */
export function sharedCookieOptions(): CookieOptions {
  const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN?.trim();
  if (!domain) return {};
  return {
    domain,
    path: "/",
    sameSite: "lax",
    secure: true,
  };
}
