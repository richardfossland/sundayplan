import { NextResponse } from "next/server";
import {
  buildTonoReport,
  buildCcliReport,
  tonoReportToCsv,
  ccliReportToCsv,
  buildChurnReport,
  buildRoleBalanceReport,
  churnReportToCsv,
  roleBalanceReportToCsv,
} from "@sundayplan/sdk";
import { schemas } from "@sundayplan/shared";
import {
  getSongUsageRows,
  getChurnInputs,
  getRoleBalanceInputs,
} from "@/lib/data/reports";

/**
 * CSV download endpoint for every report. The CSV body is produced by the pure
 * SDK serializer; this handler only fetches the rows (RLS-scoped via the data
 * layer) and sets download headers.
 *
 * Licensing:  ?kind=tono|ccli&from=YYYY-MM-DD&to=YYYY-MM-DD  (date-windowed)
 * Analytics:  ?kind=churn|role_balance                       (whole-church)
 *
 * Lives OUTSIDE the (app) route group on purpose — route handlers can't sit in
 * a group whose layout is a React Server Component — but RLS still applies via
 * the cookie-bound client inside the data layer.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawKind = url.searchParams.get("kind");

  // ── Analytics reports: no date window required ────────────────────────────
  const analyticsParsed = schemas.AnalyticsReportKind.safeParse(rawKind);
  if (analyticsParsed.success) {
    const kind = analyticsParsed.data;
    let csv: string;
    if (kind === "churn") {
      const { members, assignments } = await getChurnInputs();
      csv = churnReportToCsv(buildChurnReport(members, assignments, new Date().toISOString()));
    } else {
      const { roles, qualifications, targets } = await getRoleBalanceInputs();
      csv = roleBalanceReportToCsv(buildRoleBalanceReport(roles, qualifications, targets));
    }
    return csvResponse(csv, `${kind}-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  // ── Licensing reports: date-windowed ──────────────────────────────────────
  const kindParsed = schemas.ReportKind.safeParse(rawKind);
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

  return csvResponse(csv, `${kind}-usage-${from}_to_${to}.csv`);
}

function csvResponse(csv: string, filename: string): NextResponse {
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
