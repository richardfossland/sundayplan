/**
 * GET /api/ics/:resourceId[?token=…] — read-only ICS calendar feed for one
 * resource (Phase 4, feature 3). Members/staff subscribe in Google/Apple/Outlook.
 *
 * Authorization is per-resource:
 *   • bookable_by='public' → the feed is open (no token), since the resource is
 *     already publicly bookable; its approved holds are not sensitive.
 *   • members/staff → require `?token=` matching the resource's deterministic
 *     ICS feed token (HMAC(secret, resourceId)). Without MAGICLINK_SECRET no
 *     token can be verified → 403, and the planner UI surfaces the feed URL only
 *     when the secret is configured.
 *
 * Emits a complete `text/calendar` body built by the pure, unit-tested ICS
 * builder. One VEVENT per APPROVED booking holding the resource in a rolling
 * window (now-30d … now+180d).
 */
import { type NextRequest } from "next/server";
import {
  getResourceById,
  listResourceBookingsForIcs,
} from "@/lib/data/booking";
import { verifyIcsFeedToken } from "@/lib/booking-link";
import { buildIcsCalendar, type IcsEvent } from "@/lib/ics";

export const dynamic = "force-dynamic";

const PAST_MS = 30 * 24 * 60 * 60 * 1000;
const FUTURE_MS = 180 * 24 * 60 * 60 * 1000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ resourceId: string }> },
): Promise<Response> {
  const { resourceId } = await params;
  const resource = await getResourceById(resourceId);
  if (!resource) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  // Authorization: public resources are open; others need the feed token.
  if (resource.bookable_by !== "public") {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    const ok = await verifyIcsFeedToken(resourceId, token);
    if (!ok) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
  }

  const now = Date.now();
  const from = new Date(now - PAST_MS).toISOString();
  const to = new Date(now + FUTURE_MS).toISOString();
  const bookings = await listResourceBookingsForIcs(resourceId, { from, to });

  const events: IcsEvent[] = bookings.map((b) => ({
    uid: b.id,
    start: b.starts_at_utc,
    end: b.ends_at_utc,
    summary: b.title,
    location: resource.name,
    description: b.notes ?? b.purpose ?? null,
    status: b.status,
  }));

  const body = buildIcsCalendar(events, {
    calName: `${resource.name} — SundayBooking`,
    uidDomain: "booking.sundaysuite.app",
    dtstamp: new Date(now),
  });

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="${slugify(resource.name)}.ics"`,
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "kalender"
  );
}
