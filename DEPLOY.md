# Deploy — SundayPlan web → plan.sundaysuite.app

The Next.js web app (`apps/web`) deploys to a **Cloudflare Worker** via the
OpenNext adapter, on a `*.sundaysuite.app` subdomain — the same setup proven in
production by SundayChess (`chess.`) and SundayTurnering (`turnering.`).

> **Test phase:** SundayPlan still has open security work (the `setlist` RLS fix
> in PR #2 + the `swap_request` WITH CHECK hardening). **Do not expose this
> publicly until those land.** For the test phase, gate the subdomain behind
> **Cloudflare Access** (Zero Trust → Access → add an application for
> `plan.sundaysuite.app`, allow only your test emails). That keeps the host
> private to invited testers regardless of the RLS state.

## One-time setup

1. The zone `sundaysuite.app` already lives in Cloudflare; `custom_domain: true`
   in `apps/web/wrangler.jsonc` creates the DNS record + SSL cert automatically
   on first deploy. The free universal cert covers `*.sundaysuite.app`, so the
   **flat** `plan.` name needs no extra cert (avoid nested `*.*` names).
2. Install deps from the repo root: `pnpm install` (adds `@opennextjs/cloudflare`).
3. Authenticate wrangler once: `npx wrangler login`.

## Build-time env (inlined into the bundle)

Export before building (or set in a `.env` the build reads):
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## Runtime secret (never committed)

```
cd apps/web
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

## Deploy

```
cd apps/web
pnpm cf:deploy        # = opennextjs-cloudflare build && … deploy
# or preview locally in the Workers runtime first:
pnpm cf:preview
```

First deploy provisions `plan.sundaysuite.app`. Subsequent deploys just push a
new Worker version.

## Mobile

`apps/mobile` (Expo) is **not** a web subdomain — it ships to the App Store /
Google Play. Link to the stores from `plan.sundaysuite.app` once published.

## Marketing site

Once live, flip the SundayPlan card on `sundaysuite.app` from
"In development / Under utvikling" to a real link → `https://plan.sundaysuite.app`
(edit `sundaysuite-website/build.py`).
