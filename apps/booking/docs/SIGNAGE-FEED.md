# SundayBooking → SundayInfo signage feed

SundayBooking exposes an approved, planner-curated room board for foyer screens.
SundayInfo (a **separate repo**, `info.sundaysuite.app`) consumes it as a data
source. This file is the contract; nothing in sundayinfo is modified here.

## What is exposed

- **DB view** `booking.displayable` (migration `0023_booking_signage_ics.sql`):
  approved bookings with `show_on_signage = true`, joined to their primary
  room/resource name. Planners toggle `show_on_signage` in the create-booking
  form and the approval queue, so a screen only shows what was explicitly
  curated — no private bookings leak.
- **RPC** `booking.signage_board(p_church_id, p_now)`: current + next displayable
  booking per room, as of `p_now`.
- **Feed endpoint** `GET /api/signage/:churchSlug` (public, read-only). The
  `church_id` is resolved server-side from the slug; only signage-flagged,
  approved bookings are returned.

## Response shape

```jsonc
{
  "church": { "name": "Bookingkirken", "slug": "bookingkirken", "locale": "no" },
  "now": "2026-05-18T13:00:00.000Z",
  "rooms": [
    {
      "resource_id": "…",
      "resource_name": "Storsalen",
      "current": { "title": "Bryllup", "starts": "…14:00Z", "ends": "…18:00Z", "event_type": "bryllup" },
      "next":    { "title": "Korøvelse", "starts": "…19:00Z", "ends": "…20:00Z", "event_type": "korøvelse" }
    }
  ]
}
```

`current`/`next` are `null` when no booking matches. Render e.g.
`Storsalen: Bryllup 14–18, ledig 19:00`.

## How SundayInfo consumes it

1. Configure the church slug + `https://booking.sundaysuite.app` base URL in the
   Info display config.
2. Poll `GET /api/signage/<slug>` (the feed sets `cache-control: max-age=30`, so
   ~once a minute is cheap) and render a room board widget.
3. No auth/token is required — only approved, signage-flagged bookings are
   exposed, and the feed is church-scoped by slug.

## ICS feeds (related, Phase 4)

`GET /api/ics/:resourceId[?token=]` emits a read-only `text/calendar` feed for a
single resource so staff/members can subscribe in Google/Apple/Outlook.
Public resources (`bookable_by='public'`) are open; others require the
deterministic per-resource feed token (`icsFeedToken`, HMAC of `MAGICLINK_SECRET`).
