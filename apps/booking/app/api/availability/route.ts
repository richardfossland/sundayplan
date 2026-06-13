/**
 * /api/availability — manage weekly bookable windows for `person` resources
 * (appointment booking).
 *   GET    ?resourceId=…  — list windows (any member).
 *   POST   {resourceId, weekday, startTime, endTime} — add (planner only).
 *   DELETE {id}          — remove (planner only).
 *
 * Ownership is enforced server-side: the parent resource must belong to the
 * caller's verified church. church_id is never read from the body.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireMember, requirePlanner } from "@/lib/auth-guard";
import {
  createAvailability,
  deleteAvailability,
  listAvailability,
  resourceBelongsToChurch,
} from "@/lib/data/booking";

export const dynamic = "force-dynamic";

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export async function GET(req: NextRequest): Promise<Response> {
  const guard = await requireMember();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const resourceId = new URL(req.url).searchParams.get("resourceId");
  if (!resourceId) return NextResponse.json({ error: "resource_required" }, { status: 400 });
  if (!(await resourceBelongsToChurch(guard.ctx.churchId, resourceId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const windows = await listAvailability(resourceId);
  return NextResponse.json({ windows });
}

export async function POST(req: NextRequest): Promise<Response> {
  const guard = await requirePlanner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const resourceId = body.resourceId;
  const weekday = body.weekday;
  const startTime = body.startTime;
  const endTime = body.endTime;

  if (typeof resourceId !== "string") {
    return NextResponse.json({ error: "resource_required" }, { status: 400 });
  }
  if (typeof weekday !== "number" || weekday < 0 || weekday > 6) {
    return NextResponse.json({ error: "invalid_weekday" }, { status: 400 });
  }
  if (typeof startTime !== "string" || !TIME_RE.test(startTime)) {
    return NextResponse.json({ error: "invalid_start_time" }, { status: 400 });
  }
  if (typeof endTime !== "string" || !TIME_RE.test(endTime)) {
    return NextResponse.json({ error: "invalid_end_time" }, { status: 400 });
  }
  if (endTime <= startTime) {
    return NextResponse.json({ error: "end_before_start" }, { status: 400 });
  }
  if (!(await resourceBelongsToChurch(guard.ctx.churchId, resourceId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const window = await createAvailability({ resourceId, weekday, startTime, endTime });
  return NextResponse.json({ window }, { status: 201 });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const guard = await requirePlanner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const id = body.id;
  if (typeof id !== "string") return NextResponse.json({ error: "id_required" }, { status: 400 });

  const ok = await deleteAvailability(guard.ctx.churchId, id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
