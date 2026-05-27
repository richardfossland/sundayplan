# SundayPlan

Church service planning + volunteer scheduling — part of the **Sunday suite** alongside [SundayRec](https://github.com/richardfossland/sundayrec) and [SundayStage](https://github.com/richardfossland/sundaystage).

> ⚠️ **Status:** Phase 0–1 scaffold. Domain model designed, migrations written, shared types + Zod schemas + scoring engine in place. Web app, mobile app, and Supabase auth wiring all pending.

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

## Getting started (placeholder — Phase 0 setup pending Docker)

```bash
pnpm install                # installs all workspace deps
pnpm db:reset               # applies migrations to local Supabase (needs Docker)
pnpm dev                    # turbo dev across apps
```

## What works today

- Turborepo + pnpm-workspace plumbing
- Domain model: Mermaid ERD covering 16 entities across 6 bounded contexts
- Supabase migrations (`packages/db/migrations`):
  - 0001 — tenancy (Church, ChurchMember, RLS helpers)
  - 0002 — full core schema (member, team, role, availability, service, song,
    setlist, assignment, magic_link, comms logs) with RLS policies on every table
- Shared TypeScript types (`@sundayplan/shared`) — 30+ exported types
- Zod runtime validation schemas matching the types
- Design tokens shared between web (Tailwind) and mobile (NativeWind)
- Deterministic auto-fill scoring engine (`@sundayplan/sdk` → `scoreCandidate()`)
  with 7 components: skill match, rotation fairness, frequency balance, burnout,
  pairing, variety, custom rules

## TONO + CCLI first-class

Unlike American competitors, SundayPlan treats TONO licensing as a first-class concern. `ChurchSettings` has dedicated fields for `tono_license_status`, `tono_customer_id`, `tono_streaming_addon`, `ccli_size_category`, `ccli_streaming_addon`. Reports in Phase 11 produce both CCLI and TONO formats from a single usage log.

## License

TBD. Likely Apache-2.0 with optional commercial license for the SaaS — final decision before public launch.
