/**
 * GET /api/signage/:churchSlug — foyer-screen feed (Phase 4, feature 2).
 *
 * PUBLIC, unauthenticated, read-only. The church_id is resolved SERVER-SIDE from
 * the URL slug (never trusted from a body). Returns current + next APPROVED,
 * signage-flagged booking per room ("Storsalen: Bryllup 14–18, ledig 19:00"),
 * sourced from the `booking.displayable` view via `booking.signage_board`
 * (migration 0023). Only `show_on_signage=true` bookings are exposed, so a
 * planner explicitly curates what a screen shows — no private bookings leak.
 *
 * SundayInfo (a SEPARATE repo) consumes THIS endpoint as a data source for its
 * display surface; we do not modify sundayinfo here. See the PR note for the
 * consumption contract.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getSignageBoard, resolveChurchBySlug } from "@/lib/data/booking";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ churchSlug: string }> },
): Promise<Response> {
  const { churchSlug } = await params;
  const church = await resolveChurchBySlug(churchSlug);
  if (!church) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const now = new Date().toISOString();
  const rooms = await getSignageBoard(church.id, now);

  return NextResponse.json(
    {
      church: { name: church.name, slug: church.slug, locale: church.locale },
      now,
      rooms,
    },
    {
      // Short cache so a foyer screen polling every minute is cheap.
      headers: { "cache-control": "public, max-age=30, s-maxage=30" },
    },
  );
}
