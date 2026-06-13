/**
 * /api/resources
 *   GET   — list the church's resources (any member).
 *   POST  — create a resource (planner only).
 *   PATCH — update a resource by `id` in the body (planner only).
 *
 * church_id always comes from the verified membership, never the body.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireMember, requirePlanner } from "@/lib/auth-guard";
import { createResource, listResources, updateResource } from "@/lib/data/booking";
import type { BookableBy, ResourceKind } from "@/src/types/booking";

export const dynamic = "force-dynamic";

const KINDS: ReadonlySet<string> = new Set(["room", "equipment", "person", "vehicle"]);
const BOOKABLE: ReadonlySet<string> = new Set(["staff", "members", "public"]);

export async function GET(): Promise<Response> {
  const guard = await requireMember();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const resources = await listResources(guard.ctx.churchId);
  return NextResponse.json({ resources });
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

  const name = body.name;
  const kind = body.kind;
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  if (typeof kind !== "string" || !KINDS.has(kind)) {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }
  if (body.bookableBy !== undefined && (typeof body.bookableBy !== "string" || !BOOKABLE.has(body.bookableBy))) {
    return NextResponse.json({ error: "invalid_bookable_by" }, { status: 400 });
  }

  const resource = await createResource({
    churchId: guard.ctx.churchId,
    kind: kind as ResourceKind,
    name: name.trim(),
    description: typeof body.description === "string" ? body.description : null,
    capacity: typeof body.capacity === "number" ? body.capacity : null,
    site: typeof body.site === "string" ? body.site : null,
    color: typeof body.color === "string" ? body.color : null,
    defaultSetupMin: typeof body.defaultSetupMin === "number" ? body.defaultSetupMin : 0,
    defaultTeardownMin:
      typeof body.defaultTeardownMin === "number" ? body.defaultTeardownMin : 0,
    bookableBy:
      typeof body.bookableBy === "string" ? (body.bookableBy as BookableBy) : undefined,
    requiresApproval:
      typeof body.requiresApproval === "boolean" ? body.requiresApproval : true,
  });
  return NextResponse.json({ resource }, { status: 201 });
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
  if (body.kind !== undefined && (typeof body.kind !== "string" || !KINDS.has(body.kind))) {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }
  if (body.bookableBy !== undefined && (typeof body.bookableBy !== "string" || !BOOKABLE.has(body.bookableBy))) {
    return NextResponse.json({ error: "invalid_bookable_by" }, { status: 400 });
  }

  const resource = await updateResource(guard.ctx.churchId, id, {
    kind: typeof body.kind === "string" ? (body.kind as ResourceKind) : undefined,
    name: typeof body.name === "string" ? body.name : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    capacity: typeof body.capacity === "number" ? body.capacity : undefined,
    site: typeof body.site === "string" ? body.site : undefined,
    color: typeof body.color === "string" ? body.color : undefined,
    defaultSetupMin:
      typeof body.defaultSetupMin === "number" ? body.defaultSetupMin : undefined,
    defaultTeardownMin:
      typeof body.defaultTeardownMin === "number" ? body.defaultTeardownMin : undefined,
    bookableBy:
      typeof body.bookableBy === "string" ? (body.bookableBy as BookableBy) : undefined,
    requiresApproval:
      typeof body.requiresApproval === "boolean" ? body.requiresApproval : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
  });
  if (!resource) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ resource });
}
