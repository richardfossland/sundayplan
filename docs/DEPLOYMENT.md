# Deployment & testing runbook

SundayPlan is a Turborepo monorepo: a Next.js web admin (`apps/web`), Supabase
Edge Functions (`supabase/functions`), and a Postgres schema with RLS
(`supabase/migrations`). There is no installable binary — "testing" means
running the web app against a Supabase backend.

Two paths:

- **[A] Local full-stack** — anyone with Docker can run the whole thing on their
  machine. This is the fastest way to test the current build end to end.
- **[B] Hosted staging** — a real Supabase cloud project + Vercel deploy, so
  testers only need a browser. Needs the project owner's Supabase + Vercel
  accounts and a few secrets.

---

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | web (`.env.local`) | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web (`.env.local`) | anon key (RLS-scoped, safe in the browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | web (`.env.local`, **server only**) | used by the admin client for church/onboarding inserts that have no INSERT RLS by design — never expose to the browser |
| `MAGICLINK_SECRET` | Edge Functions (`supabase secrets set`) | signs magic-link JWTs; MUST differ from the Supabase JWT secret |

Templates: `apps/web/.env.example`, `supabase/functions/.env.example`. The
`.env.local` / `.env` files are gitignored.

---

## [A] Local full-stack test

Prerequisites: Docker (or Colima), the Supabase CLI, Node 22, pnpm 11.4.0.

```bash
# 1. Start a container runtime (Colima shown; Docker Desktop works too)
colima start                       # or: open -a Docker

# 2. Bring up the local Supabase stack from the repo root
supabase start                     # Postgres :54322, API :54321, Studio :54323

# 3. Apply the schema + seed (only needed on first run / to reset)
supabase db reset                  # runs migrations 0001..0005 + seed.sql

# 4. Web env: copy the example and fill in the keys `supabase start` printed
cp apps/web/.env.example apps/web/.env.local
#   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from `supabase status`>
#   SUPABASE_SERVICE_ROLE_KEY=<service_role key from `supabase status`>

# 5. (Optional) Edge Functions for the magic-link flow
cp supabase/functions/.env.example supabase/functions/.env   # set MAGICLINK_SECRET
supabase functions serve

# 6. Install + run the web app
pnpm install
pnpm --filter @sundayplan/web dev   # http://localhost:3000
```

**Demo login:** `planner@alta.test` / `planner123` — an admin of the seeded
church "Alta Frikirke" (6 members, 3 teams, 4 June services). New emails you
sign up with land on `/onboarding` to create their own church.

`supabase status -o env` prints the keys non-interactively if you script step 4.

---

## [B] Hosted staging (Supabase Cloud + Vercel)

Needs: a Supabase organization and a Vercel account (project owner's).

### 1. Supabase project

```bash
supabase login
supabase projects create sundayplan-staging      # note the project ref
supabase link --project-ref <ref>
supabase db push                                  # applies supabase/migrations
supabase secrets set MAGICLINK_SECRET="$(openssl rand -hex 32)"
supabase functions deploy magic-link-issue magic-link-respond
```

Do **not** push `supabase/seed.sql` to a shared/staging DB — it contains a
known demo password. Create a real account via the app's sign-up → onboarding
instead. (Seed is for local only.)

Grab the project's API URL + anon key + service-role key from the Supabase
dashboard → Project Settings → API.

### 2. Vercel project

- Import the repo; set **Root Directory** to `apps/web`.
- Framework preset: Next.js. Build command `next build`, install `pnpm install`.
  (The monorepo builds the workspace deps via `transpilePackages`.)
- Environment variables (Production + Preview):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (mark as a server-side secret)
- Deploy.

### 3. Post-deploy smoke checklist

1. Sign up with a new email → redirected to `/onboarding` → create a church.
2. `/people` → add a member; `/teams` → create a team, add roles + members.
3. `/services` → create a service (try "from template" after making one under
   `/services/templates`); add order-of-service items.
4. `/schedule` → "Auto-fill gaps", then hand-assign; confirm conflicts surface.
5. `/songs` → add a song; attach it to a `song` service item.
6. On a person page, add an unavailability block → confirm it influences the
   schedule's conflicts.

---

## CI

`.github/workflows/ci.yml` runs `typecheck → test → build` on every push and PR
to `main` (Node 22, pnpm 11.4.0). It needs no secrets — the build gets
placeholder `NEXT_PUBLIC_*` values because the Supabase clients are constructed
per-request, never at build time.

## Known limitations (v0.1.0)

- **Web admin only.** The Expo mobile app (`apps/mobile`) and the volunteer
  magic-link response *page* are scaffold/in-progress (Phases 7–8).
- **No outbound comms yet.** SMS/email/push (Phase 6) aren't wired, so magic
  links aren't actually delivered — the Edge Functions exist and are testable
  directly, but there's no send pipeline.
- **Dashboard** still runs the SDK engines on crafted mock data by design.
- **Lint** is a placeholder across packages; CI enforces typecheck/test/build.
