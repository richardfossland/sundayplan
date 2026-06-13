/**
 * /api/bundles
 *   GET    — list the church's resource bundles + their item ids (any member).
 *   POST   — create a bundle (planner only).
 *   DELETE — delete a bundle by `id` in the body (planner only).
 *
 * church_id always comes from the verified membership, never the body.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireMember, requirePlanner } from "@/lib/auth-guard";
import { createBundle, deleteBundle, listBundles } from "@/lib/data/booking";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const guard = await requireMember();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const bundles = await listBundles(guard.ctx.churchId);
  return NextResponse.json({ bundles });
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
  const primaryResourceId = body.primaryResourceId;
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  if (typeof primaryResourceId !== "string" || !primaryResourceId) {
    return NextResponse.json({ error: "primary_required" }, { status: 400 });
  }
  const itemResourceIds = Array.isArray(body.itemResourceIds)
    ? (body.itemResourceIds as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  const bundle = await createBundle({
    churchId: guard.ctx.churchId,
    name: name.trim(),
    primaryResourceId,
    itemResourceIds,
  });
  return NextResponse.json({ bundle }, { status: 201 });
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
  if (typeof id !== "string") {
    return NextResponse.json({ error: "id_required" }, { status: 400 });
  }
  await deleteBundle(guard.ctx.churchId, id);
  return NextResponse.json({ ok: true });
}
