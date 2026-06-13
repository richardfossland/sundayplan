/**
 * GET /api/public/:churchSlug/slots?resourceId=&from=&to=&slot=
 *
 * PUBLIC, unauthenticated. Returns free appointment slots for a `person`
 * resource (Calendly-style). The resource MUST be a public, person-kind resource
 * of the church resolved from the slug; otherwise 403/404 — no member/staff
 * resource leaks. Slots are derived server-side (availability windows minus
 * approved holds) via the pure `computeFreeSlots`.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  computeFreeSlots,
  listPublicResources,
  resolveChurchBySlug,
} from "@/lib/data/booking";

export const dynamic = "force-dynamic";

const MAX_RANGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ churchSlug: string }> },
): Promise<Response> {
  const { churchSlug } = await params;
  const church = await resolveChurchBySlug(churchSlug);
  if (!church) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const url = new URL(req.url);
  const resourceId = url.searchParams.get("resourceId");
  if (!resourceId) {
    return NextResponse.json({ error: "resource_required" }, { status: 400 });
  }

  // Whitelist to this church's public person resources.
  const resources = await listPublicResources(church.id);
  const resource = resources.find((r) => r.id === resourceId && r.kind === "person");
  if (!resource) {
    return NextResponse.json({ error: "resource_not_bookable" }, { status: 403 });
  }

  const now = Date.now();
  const from = url.searchParams.get("from") ?? new Date(now).toISOString();
  const to =
    url.searchParams.get("to") ?? new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString();
  // Clamp the requested range so an anon caller can't ask for a huge span.
  const fromMs = Date.parse(from);
  let toMs = Date.parse(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return NextResponse.json({ error: "bad_range" }, { status: 400 });
  }
  if (toMs - fromMs > MAX_RANGE_MS) toMs = fromMs + MAX_RANGE_MS;

  const slotMinutes = clampSlot(Number(url.searchParams.get("slot")) || 30);

  const slots = await computeFreeSlots({
    resourceId,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    slotMinutes,
    now: new Date(now).toISOString(),
  });

  return NextResponse.json({ slots, slotMinutes });
}

function clampSlot(n: number): number {
  if (!Number.isFinite(n) || n < 10) return 30;
  if (n > 240) return 240;
  return Math.round(n);
}
