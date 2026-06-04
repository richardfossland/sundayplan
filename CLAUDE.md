# CLAUDE.md — SundayPlan

SundayPlan is church service planning + volunteer scheduling.
Part of the Sunday suite alongside SundayRec (recording) and SundayStage (presentation).

## Target user

A volunteer or part-time staffer at a small church (10-300 people) who is currently using a spreadsheet, WhatsApp group, or a too-expensive Planning Center plan.

## Core promises

1. **Volunteers never need an account.** SMS magic link → tap accept → done.
2. **AI does the rota draft for you.** You tweak; you don't author from scratch.
3. **Free tier is genuinely useful.** Pro tier is genuinely cheap.
4. **Native mobile from launch** — not a "mobile-friendly web page".
5. **Plays seamlessly with SundayRec and SundayStage.** Setlist made here flows into Stage. Recordings from Rec metadata-link back here.

## Competitive positioning

- vs **Planning Center** ($14-199+/mo modular): 1/5 the price, smarter scheduling, no-account volunteers, AI-native
- vs **Elvanto / ChMeetings / Tithely** ($72-119/mo flat): much cheaper, much simpler, built for the small-church reality
- vs **SetBook** (worship-only): broader (all ministries, not just music) but still focused
- vs **GraceSquad** (auto-fill ambitions): we ship the auto-fill AND the Sunday-suite integration

## Tech principles

- **Multi-tenant from day one.** Every query carries a `church_id`.
- **Mobile is a first-class deliverable**, not an afterthought.
- **Communication is core**: SMS, email, push must be reliable and observable.
- **Privacy:** GDPR-by-design (we'll have German + Norwegian customers).
- **Languages at launch:** Norwegian + English. Then Swedish, Danish, German, French, Polish (match the rest of the Sunday suite).

## Stack

- **Monorepo:** Turborepo + pnpm workspaces
- **Backend:** Supabase (Postgres + Auth + Realtime + Storage + Edge Functions)
- **Web admin:** Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui
- **Mobile:** Expo SDK 52+ React Native + TypeScript + NativeWind
- **Shared:** TypeScript SDK, Zod schemas, domain types

## Repository layout

```
sundayplan/
├── apps/
│   ├── web/              Next.js admin (planners, leaders) — also hosts the
│   │                     UI primitives in components/ui.tsx
│   └── mobile/           Expo app (volunteers + leaders on mobile)
├── packages/
│   ├── sdk/              Typed client SDK + scheduling engines (used by web + mobile)
│   ├── shared/           Domain types, Zod schemas, business rules
│   ├── auth/             Server-only auth primitives (magic-link JWT, RSVP)
│   └── db/               Supabase migrations + generated types
├── supabase/
│   └── functions/        Supabase Edge Functions (Deno)
├── docs/
└── turbo.json
```

## Out of scope for v1

- Online giving / Vipps
- Attendance tracking
- Children's check-in with safety / family management
- Full CRM (visitor pipeline, follow-ups)

## What this repo contains (June 2026)

- Turborepo + pnpm-workspace plumbing
- Domain model documented in `docs/DOMAIN.md` (Mermaid ERD)
- Supabase migrations: tenancy + core domain (`packages/db`) + Edge Functions
  (`supabase/functions`)
- Shared TypeScript types + Zod schemas in `packages/shared`
- Scheduling/auto-fill/conflict/coverage engines + typed SDK in `packages/sdk`
- Server-only auth primitives (magic-link JWT, RSVP) in `packages/auth`
- Next.js 15 web app in `apps/web` — full pages, server actions, and a
  Supabase-backed data layer (`lib/data/*`); UI primitives in `components/ui.tsx`
- Expo app scaffold in `apps/mobile` (still a placeholder — typechecks)

## What's pending

See `docs/DOMAIN.md` phase-status table.
