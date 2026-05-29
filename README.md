# SundayPlan

[![CI](https://github.com/richardfossland/sundayplan/actions/workflows/ci.yml/badge.svg)](https://github.com/richardfossland/sundayplan/actions/workflows/ci.yml)

Church service planning + volunteer scheduling — part of the **Sunday suite** alongside [SundayRec](https://github.com/richardfossland/sundayrec) and [SundayStage](https://github.com/richardfossland/sundaystage).

> **Status (v0.1.0 — web admin, testable):** Phases 0–5 of the web admin run on live Supabase data under RLS — auth + onboarding, people, teams + roles, services + order-of-service, service templates, the song library, availability, and the schedule grid with deterministic auto-fill + live conflict detection. Mobile app + outbound comms (SMS/email/push) are still pending. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) to run it.

## What SundayPlan does

For a volunteer or part-time staffer at a small church (10–300 people) who's currently using a spreadsheet, WhatsApp group, or a too-expensive Planning Center plan:

1. **Volunteers never need an account** — SMS magic link → tap accept → done.
2. **AI does the rota draft for you** — you tweak, you don't author from scratch.
3. **Free tier is genuinely useful** — Pro tier is genuinely cheap.
4. **Native mobile from launch** — not a "mobile-friendly web page".
5. **Plays seamlessly with SundayRec and SundayStage** — setlists flow into Stage; recordings link back here.

See `CLAUDE.md` for full positioning + tech principles.

## Stack

- **Monorepo:** Turborepo + pnpm workspaces
- **Backend:** Supabase (Postgres + Auth + Realtime + Storage + Edge Functions)
- **Web admin:** Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui (Phase 2)
- **Mobile:** Expo SDK 52+ React Native + NativeWind (Phase 8)
- **Shared:** TypeScript SDK, Zod schemas, deterministic auto-fill scoring engine

## Repository layout

```
sundayplan/
├── apps/
│   ├── web/              Next.js admin (Phase 2)
│   ├── mobile/           Expo app (Phase 8)
│   └── functions/        Supabase Edge Functions (Phase 1.3+)
├── packages/
│   ├── shared/           Types + Zod schemas + design tokens
│   ├── sdk/              Typed client SDK + scoring engine
│   ├── db/               Supabase migrations + generated types
│   └── ui-web/           shadcn-based primitives (Phase 0.4)
├── docs/
│   └── DOMAIN.md         Mermaid ERD + entity reference + hardest queries
└── turbo.json
```

## Getting started

```bash
colima start                          # or open Docker Desktop
supabase start                        # local Supabase (Postgres/API/Studio)
supabase db reset                     # apply migrations 0001..0005 + seed
cp apps/web/.env.example apps/web/.env.local   # fill in keys from `supabase status`
pnpm install                          # installs all workspace deps
pnpm --filter @sundayplan/web dev     # http://localhost:3000
```

Demo login: **`planner@alta.test` / `planner123`** (admin of the seeded church).
Full local + hosted instructions: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## What works today

Web admin (`apps/web`) on live Supabase data, all under per-church RLS:

- **Auth + onboarding** — email sign-in/up via `@supabase/ssr`, middleware
  session gating, create-a-church onboarding for new users
- **People** — registry + CRUD, per-member availability (recurring / range /
  single date) feeding the scheduling engine
- **Teams** — CRUD, roles with required skill level, member→role composition
- **Services** — list + CRUD, order-of-service editor (add/reorder/edit/delete
  items), assignments panel; **templates** define a default order + the roles a
  service needs, and new services can be seeded from one
- **Songs** — light library (metadata + file links, CCLI/TONO ids), filters,
  service history; attachable to `song` order-of-service items
- **Schedule** — roles × services grid, click-to-assign from the eligible pool,
  "✨ Auto-fill gaps", and live conflict detection (double-book, unavailable,
  skill gap, unfilled-near-deadline, …)

Foundations:

- Supabase migrations (`supabase/migrations`) 0001 tenancy → 0005, RLS on every
  table (0005 closed an RLS gap on service/template item tables)
- `@sundayplan/shared` — 30+ types + Zod schemas + design tokens
- `@sundayplan/sdk` — deterministic scoring engine (7 components) + a 9-rule
  conflict engine; **83 unit tests** (shared + auth + sdk)
- `@sundayplan/auth` — magic-link JWT core + Edge Functions (issue/respond)

## TONO + CCLI first-class

Unlike American competitors, SundayPlan treats TONO licensing as a first-class concern. `ChurchSettings` has dedicated fields for `tono_license_status`, `tono_customer_id`, `tono_streaming_addon`, `ccli_size_category`, `ccli_streaming_addon`. Reports in Phase 11 produce both CCLI and TONO formats from a single usage log.

## License

TBD. Likely Apache-2.0 with optional commercial license for the SaaS — final decision before public launch.
