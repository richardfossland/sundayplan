/**
 * /api/event-types
 *   GET  — list the church's event types (any member).
 *   POST — create one, or with `{ seedDefaults: true }` seed the Norwegian
 *          defaults (planner only). church_id from the verified membership.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireMember, requirePlanner } from "@/lib/auth-guard";
import {
  createEventType,
  listEventTypes,
  seedDefaultEventTypes,
  updateEventType,
} from "@/lib/data/booking";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const guard = await requireMember();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const eventTypes = await listEventTypes(guard.ctx.churchId);
  return NextResponse.json({ eventTypes });
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

  if (body.seedDefaults === true) {
    await seedDefaultEventTypes(guard.ctx.churchId);
    const eventTypes = await listEventTypes(guard.ctx.churchId);
    return NextResponse.json({ eventTypes }, { status: 201 });
  }

  const name = body.name;
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }

  const eventType = await createEventType({
    churchId: guard.ctx.churchId,
    name: name.trim(),
    defaultSetupMin: typeof body.defaultSetupMin === "number" ? body.defaultSetupMin : 0,
    defaultTeardownMin:
      typeof body.defaultTeardownMin === "number" ? body.defaultTeardownMin : 0,
    defaultDurationMin:
      typeof body.defaultDurationMin === "number" ? body.defaultDurationMin : 60,
    color: typeof body.color === "string" ? body.color : null,
    requiresApproval:
      typeof body.requiresApproval === "boolean" ? body.requiresApproval : true,
    terms: typeof body.terms === "string" ? body.terms : null,
  });
  return NextResponse.json({ eventType }, { status: 201 });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const guard = await requirePlanner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const id = body.id;
  if (typeof id !== "string") {
    return NextResponse.json({ error: "id_required" }, { status: 400 });
  }

  const eventType = await updateEventType(guard.ctx.churchId, id, {
    name: typeof body.name === "string" ? body.name : undefined,
    defaultSetupMin:
      typeof body.defaultSetupMin === "number" ? body.defaultSetupMin : undefined,
    defaultTeardownMin:
      typeof body.defaultTeardownMin === "number" ? body.defaultTeardownMin : undefined,
    defaultDurationMin:
      typeof body.defaultDurationMin === "number" ? body.defaultDurationMin : undefined,
    color: typeof body.color === "string" ? body.color : undefined,
    requiresApproval:
      typeof body.requiresApproval === "boolean" ? body.requiresApproval : undefined,
    terms: typeof body.terms === "string" ? body.terms : undefined,
  });
  if (!eventType) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ eventType });
}
