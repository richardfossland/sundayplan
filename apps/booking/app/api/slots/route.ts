/**
 * GET /api/slots?resourceId=&from=&to=&slot= — free appointment slots for a
 * member (SSO). Mirrors the public slots endpoint but scopes to the caller's
 * verified church and allows any member-bookable `person` resource.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireMember } from "@/lib/auth-guard";
import { computeFreeSlots, listMemberBookableResources } from "@/lib/data/booking";

export const dynamic = "force-dynamic";

const MAX_RANGE_MS = 60 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest): Promise<Response> {
  const guard = await requireMember();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const url = new URL(req.url);
  const resourceId = url.searchParams.get("resourceId");
  if (!resourceId) return NextResponse.json({ error: "resource_required" }, { status: 400 });

  const resources = await listMemberBookableResources(guard.ctx.churchId);
  const resource = resources.find((r) => r.id === resourceId && r.kind === "person");
  if (!resource) return NextResponse.json({ error: "resource_not_bookable" }, { status: 403 });

  const now = Date.now();
  const fromMs = Date.parse(url.searchParams.get("from") ?? new Date(now).toISOString());
  let toMs = Date.parse(
    url.searchParams.get("to") ?? new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString(),
  );
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return NextResponse.json({ error: "bad_range" }, { status: 400 });
  }
  if (toMs - fromMs > MAX_RANGE_MS) toMs = fromMs + MAX_RANGE_MS;

  const slotMinutes = Math.min(240, Math.max(10, Number(url.searchParams.get("slot")) || 30));

  const slots = await computeFreeSlots({
    resourceId,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    slotMinutes,
    now: new Date(now).toISOString(),
  });
  return NextResponse.json({ slots, slotMinutes });
}
