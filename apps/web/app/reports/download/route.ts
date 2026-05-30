import { NextResponse } from "next/server";
import {
  buildTonoReport,
  buildCcliReport,
  tonoReportToCsv,
  ccliReportToCsv,
} from "@sundayplan/sdk";
import { schemas } from "@sundayplan/shared";
import { getSongUsageRows } from "@/lib/data/reports";

/**
 * CSV download endpoint for the Phase 11 licensing reports. The CSV body is
 * produced by the pure SDK serializer; this handler only fetches the rows
 * (RLS-scoped via the data layer) and sets download headers.
 *
 * Query: ?kind=tono|ccli&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Lives OUTSIDE the (app) route group on purpose — route handlers can't sit in
 * a group whose layout is a React Server Component — but RLS still applies via
 * the cookie-bound client inside getSongUsageRows.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kindParsed = schemas.ReportKind.safeParse(url.searchParams.get("kind"));
  const paramsParsed = schemas.ReportParamsSchema.safeParse({
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  });
  if (!kindParsed.success || !paramsParsed.success) {
    return NextResponse.json({ error: "invalid report params" }, { status: 400 });
  }

  const kind = kindParsed.data;
  const { from, to } = paramsParsed.data;
  const rows = await getSongUsageRows(from, to);

  const csv =
    kind === "tono"
      ? tonoReportToCsv(buildTonoReport(rows, from, to))
      : ccliReportToCsv(buildCcliReport(rows, from, to));

  const filename = `${kind}-usage-${from}_to_${to}.csv`;
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
