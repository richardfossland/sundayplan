import { NextResponse, type NextRequest } from "next/server";
import { search } from "@/lib/data/search";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json(await search(q));
}
