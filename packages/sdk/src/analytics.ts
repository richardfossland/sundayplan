/**
 * Phase 12 — volunteer-analytics depth, layered on top of {@link ./coverage}.
 *
 * Two pure, deterministic reporting engines the planner uses to decide WHERE to
 * invest recruiting/retention effort:
 *
 *  1. {@link buildChurnReport} — onboarding speed (time-to-first-assignment),
 *     dropout + at-risk detection, and a retention snapshot.
 *  2. {@link buildRoleBalanceReport} — per-role qualified-capacity vs a target
 *     (heatmap data) so under-staffed roles surface for recruiting.
 *
 * No I/O and no `Date.now()`: callers pass `now` (an ISO instant). Dates are
 * compared on the local YYYY-MM-DD portion, matching coverage.ts / reports.ts.
 * The day count between two dates is computed from those calendar days (UTC
 * midnight of each), so it is timezone- and DST-stable.
 */

// ── Shared date helpers (mirror coverage.ts) ─────────────────────────────────

function localDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Whole days from `a` to `b` (b − a), using each value's local calendar day. */
export function dayGapLocal(a: string, b: string): number {
  const da = Date.parse(`${localDate(a)}T00:00:00Z`);
  const db = Date.parse(`${localDate(b)}T00:00:00Z`);
  return Math.round((db - da) / 86_400_000);
}

/** Whole calendar months from `a` to `b` (b − a), can be negative. */
export function monthGapLocal(a: string, b: string): number {
  const [ay, am, ad] = localDate(a).split("-").map(Number);
  const [by, bm, bd] = localDate(b).split("-").map(Number);
  let months = (by - ay) * 12 + (bm - am);
  // Only count a month as elapsed once the day-of-month is reached, so
  // "joined Jan 31, now Feb 15" is 0 months, not 1.
  if (bd < ad) months -= 1;
  return months;
}

// ── 1. Churn / retention ─────────────────────────────────────────────────────

/** One member as the churn engine sees them (already church-scoped). */
export interface ChurnMember {
  memberId: string;
  name: string;
  /** ISO date the member joined; null when unknown (excluded from tenure math). */
  joinedAtLocal: string | null;
  /** 'active' members are the retention/at-risk universe; others are informational. */
  status: "active" | "inactive" | "archived";
}

/** One committed serve (declined/removed already excluded by the data layer). */
export interface ChurnAssignment {
  memberId: string;
  serviceDateLocal: string;
}

/** Inclusive day boundaries for the time-to-first-assignment histogram. */
export interface ChurnBucket {
  /** stable key for UI/CSV (e.g. "0-7") */
  key: string;
  /** inclusive lower bound in days */
  minDays: number;
  /** inclusive upper bound in days, or null for the open-ended final bucket */
  maxDays: number | null;
  count: number;
}

export interface ChurnAtRiskLine {
  memberId: string;
  name: string;
  lastServeLocal: string;
  /** whole days since the last serve, relative to `now` */
  daysSinceLastServe: number;
}

export interface ChurnDropoutLine {
  memberId: string;
  name: string;
  joinedAtLocal: string;
  /** whole months since joining, relative to `now` */
  monthsSinceJoin: number;
}

export interface RetentionPoint {
  /** cohort window in months (3, 6, 12) */
  months: number;
  /** members whose join is old enough to evaluate at this horizon */
  eligible: number;
  /** of the eligible, how many are still active now */
  stillActive: number;
  /** stillActive / eligible, or null when nobody is eligible yet */
  rate: number | null;
}

export interface ChurnReportConfig {
  /**
   * Dropout: joined at least this many months ago AND zero serves ever.
   * Inclusive — exactly `dropoutJoinedMonths` months counts. Default 3.
   */
  dropoutJoinedMonths: number;
  /**
   * At-risk: an active member who HAS served before but whose most-recent serve
   * is at least this many days in the past. Inclusive. Default 14 (≈2 weeks).
   */
  atRiskSilentDays: number;
  /** Histogram edges (inclusive upper bounds) for time-to-first-assignment. */
  firstServeBucketEdges: number[];
}

export const DEFAULT_CHURN_CONFIG: ChurnReportConfig = {
  dropoutJoinedMonths: 3,
  atRiskSilentDays: 14,
  firstServeBucketEdges: [7, 30, 90],
};

export interface ChurnReport {
  now: string;
  config: ChurnReportConfig;
  /** time-to-first-assignment histogram; partitions every member who has served */
  firstServeBuckets: ChurnBucket[];
  /** members who have served but whose first serve date is unknown (no join date) */
  firstServeUnknown: number;
  /** never-served members joined long enough ago to look dormant */
  dropout: ChurnDropoutLine[];
  /** active members who served before but have gone quiet */
  atRisk: ChurnAtRiskLine[];
  retention: RetentionPoint[];
  totals: {
    members: number;
    activeMembers: number;
    everServed: number;
    neverServed: number;
  };
}

function buildBuckets(edges: number[]): ChurnBucket[] {
  // De-dup + sort defensively so callers can pass edges in any order.
  const sorted = [...new Set(edges)].filter((e) => e >= 0).sort((a, b) => a - b);
  const buckets: ChurnBucket[] = [];
  let min = 0;
  for (const edge of sorted) {
    buckets.push({ key: `${min}-${edge}`, minDays: min, maxDays: edge, count: 0 });
    min = edge + 1;
  }
  buckets.push({ key: `${min}+`, minDays: min, maxDays: null, count: 0 });
  return buckets;
}

/** Place `days` into the first bucket whose [minDays, maxDays] contains it. */
function placeInBucket(buckets: ChurnBucket[], days: number): void {
  for (const b of buckets) {
    if (days >= b.minDays && (b.maxDays == null || days <= b.maxDays)) {
      b.count += 1;
      return;
    }
  }
}

/**
 * Build the churn / retention report. Pure: all "now"-relative reasoning uses
 * the passed `now`.
 *
 * - firstServe buckets partition EVERY member who has served and has a join date
 *   (negative gaps — a serve dated before the join — are clamped to 0).
 * - dropout, at-risk and retention are mutually independent signals.
 */
export function buildChurnReport(
  members: ChurnMember[],
  assignments: ChurnAssignment[],
  now: string,
  config: Partial<ChurnReportConfig> = {},
): ChurnReport {
  const cfg: ChurnReportConfig = { ...DEFAULT_CHURN_CONFIG, ...config };

  // first + last serve per member, in one pass (calendar-day comparison).
  const firstServe = new Map<string, string>();
  const lastServe = new Map<string, string>();
  for (const a of assignments) {
    const d = localDate(a.serviceDateLocal);
    const f = firstServe.get(a.memberId);
    if (f == null || d < f) firstServe.set(a.memberId, d);
    const l = lastServe.get(a.memberId);
    if (l == null || d > l) lastServe.set(a.memberId, d);
  }

  const buckets = buildBuckets(cfg.firstServeBucketEdges);
  let firstServeUnknown = 0;
  const dropout: ChurnDropoutLine[] = [];
  const atRisk: ChurnAtRiskLine[] = [];

  let activeMembers = 0;
  let everServed = 0;

  for (const m of members) {
    const served = firstServe.has(m.memberId);
    if (served) everServed += 1;
    if (m.status === "active") activeMembers += 1;

    // (a) time-to-first-assignment histogram
    if (served) {
      if (m.joinedAtLocal == null) {
        firstServeUnknown += 1;
      } else {
        const gap = Math.max(0, dayGapLocal(m.joinedAtLocal, firstServe.get(m.memberId)!));
        placeInBucket(buckets, gap);
      }
    }

    // (b) dropout — joined long ago, never served
    if (!served && m.joinedAtLocal != null) {
      const monthsSinceJoin = monthGapLocal(m.joinedAtLocal, now);
      if (monthsSinceJoin >= cfg.dropoutJoinedMonths) {
        dropout.push({ memberId: m.memberId, name: m.name, joinedAtLocal: m.joinedAtLocal, monthsSinceJoin });
      }
    }

    // (c) at-risk — active, served before, now quiet
    if (m.status === "active" && served) {
      const last = lastServe.get(m.memberId)!;
      const silent = dayGapLocal(last, now);
      if (silent >= cfg.atRiskSilentDays) {
        atRisk.push({ memberId: m.memberId, name: m.name, lastServeLocal: last, daysSinceLastServe: silent });
      }
    }
  }

  // most-overdue / longest-dormant first, then name — stable for CSV + UI.
  dropout.sort((a, b) => b.monthsSinceJoin - a.monthsSinceJoin || a.name.localeCompare(b.name));
  atRisk.sort((a, b) => b.daysSinceLastServe - a.daysSinceLastServe || a.name.localeCompare(b.name));

  // (d) retention snapshot at 3/6/12 months: of members whose join is at least
  //     H months in the past (the cohort that COULD churn by horizon H), what
  //     fraction is still active now?
  const retention: RetentionPoint[] = [3, 6, 12].map((months) => {
    let eligible = 0;
    let stillActive = 0;
    for (const m of members) {
      if (m.joinedAtLocal == null) continue;
      if (monthGapLocal(m.joinedAtLocal, now) < months) continue;
      eligible += 1;
      if (m.status === "active") stillActive += 1;
    }
    return { months, eligible, stillActive, rate: eligible === 0 ? null : stillActive / eligible };
  });

  return {
    now: localDate(now),
    config: cfg,
    firstServeBuckets: buckets,
    firstServeUnknown,
    dropout,
    atRisk,
    retention,
    totals: {
      members: members.length,
      activeMembers,
      everServed,
      neverServed: members.length - everServed,
    },
  };
}

// ── 2. Role-balance heatmap ──────────────────────────────────────────────────

export interface RoleRef {
  roleId: string;
  roleName: string;
  /** team grouping for the heatmap; optional */
  teamName?: string | null;
}

/** A member's qualification for a role (the data layer resolves team membership). */
export interface RoleQualification {
  roleId: string;
  memberId: string;
  /** false when the member is inactive/archived — counts toward capacity gap */
  active: boolean;
}

/** Optional per-role recruiting target (desired number of qualified ACTIVE people). */
export interface RoleTarget {
  roleId: string;
  target: number;
}

export interface RoleBalanceLine {
  roleId: string;
  role: string;
  teamName: string | null;
  /** distinct qualified members (any status) */
  qualified: number;
  /** distinct qualified members who are active */
  activeQualified: number;
  /** target, or null when none configured */
  target: number | null;
  /**
   * activeQualified − target; positive = over-capacity (healthy bench),
   * negative = UNDER-capacity (recruit here). null when no target.
   */
  delta: number | null;
  /** convenience flag for the heatmap; null when no target */
  status: "over" | "balanced" | "under" | null;
}

export interface RoleBalanceReport {
  lines: RoleBalanceLine[];
  totals: {
    roles: number;
    rolesWithTarget: number;
    underStaffed: number;
    overStaffed: number;
    /** sum of shortfalls (how many more qualified actives are needed overall) */
    totalShortfall: number;
  };
}

/**
 * Build per-role capacity vs target. Pure + deterministic.
 *
 * `qualifications` may contain duplicates (a member listed twice for a role); we
 * count DISTINCT members per role. Roles with no qualifications still appear
 * (capacity 0) so empty roles are visible. Unknown role ids in qualifications /
 * targets are ignored (the role list is authoritative).
 */
export function buildRoleBalanceReport(
  roles: RoleRef[],
  qualifications: RoleQualification[],
  targets: RoleTarget[] = [],
): RoleBalanceReport {
  const targetByRole = new Map(targets.map((t) => [t.roleId, t.target]));

  // role → distinct member sets (all + active)
  const all = new Map<string, Set<string>>();
  const active = new Map<string, Set<string>>();
  const roleIds = new Set(roles.map((r) => r.roleId));
  for (const q of qualifications) {
    if (!roleIds.has(q.roleId)) continue;
    (all.get(q.roleId) ?? all.set(q.roleId, new Set()).get(q.roleId)!).add(q.memberId);
    if (q.active) {
      (active.get(q.roleId) ?? active.set(q.roleId, new Set()).get(q.roleId)!).add(q.memberId);
    }
  }

  const lines: RoleBalanceLine[] = roles.map((r) => {
    const qualified = all.get(r.roleId)?.size ?? 0;
    const activeQualified = active.get(r.roleId)?.size ?? 0;
    const target = targetByRole.get(r.roleId) ?? null;
    const delta = target == null ? null : activeQualified - target;
    const status: RoleBalanceLine["status"] =
      delta == null ? null : delta > 0 ? "over" : delta < 0 ? "under" : "balanced";
    return {
      roleId: r.roleId,
      role: r.roleName,
      teamName: r.teamName ?? null,
      qualified,
      activeQualified,
      target,
      delta,
      status,
    };
  });

  // Most under-staffed first (smallest delta), nulls last, then by name.
  lines.sort((a, b) => {
    if (a.delta == null && b.delta == null) return a.role.localeCompare(b.role);
    if (a.delta == null) return 1;
    if (b.delta == null) return -1;
    return a.delta - b.delta || a.role.localeCompare(b.role);
  });

  let underStaffed = 0;
  let overStaffed = 0;
  let totalShortfall = 0;
  for (const l of lines) {
    if (l.status === "under") {
      underStaffed += 1;
      totalShortfall += -(l.delta as number);
    } else if (l.status === "over") {
      overStaffed += 1;
    }
  }

  return {
    lines,
    totals: {
      roles: lines.length,
      rolesWithTarget: lines.filter((l) => l.target != null).length,
      underStaffed,
      overStaffed,
      totalShortfall,
    },
  };
}

// ── CSV serializers (reuse the licensing report's escaping contract) ──────────

import { toCsvRow } from "./reports";

/** Churn report → CSV: buckets, then dropout, then at-risk, then retention. */
export function churnReportToCsv(report: ChurnReport): string {
  const lines: string[] = [];
  lines.push(toCsvRow(["section", "key", "label", "value", "detail"]));
  for (const b of report.firstServeBuckets) {
    const label = b.maxDays == null ? `${b.minDays}+ days` : `${b.minDays}-${b.maxDays} days`;
    lines.push(toCsvRow(["first_serve", b.key, label, b.count, ""]));
  }
  lines.push(toCsvRow(["first_serve", "unknown", "no join date", report.firstServeUnknown, ""]));
  for (const d of report.dropout) {
    lines.push(toCsvRow(["dropout", d.memberId, d.name, d.monthsSinceJoin, d.joinedAtLocal]));
  }
  for (const a of report.atRisk) {
    lines.push(toCsvRow(["at_risk", a.memberId, a.name, a.daysSinceLastServe, a.lastServeLocal]));
  }
  for (const p of report.retention) {
    const rate = p.rate == null ? "" : (p.rate * 100).toFixed(0) + "%";
    lines.push(toCsvRow(["retention", `${p.months}m`, `${p.months} months`, rate, `${p.stillActive}/${p.eligible}`]));
  }
  return lines.join("\n");
}

/** Role-balance report → CSV (one row per role). */
export function roleBalanceReportToCsv(report: RoleBalanceReport): string {
  const header = toCsvRow(["role", "team", "qualified", "active_qualified", "target", "delta", "status"]);
  const rows = report.lines.map((l) =>
    toCsvRow([
      l.role,
      l.teamName ?? "",
      l.qualified,
      l.activeQualified,
      l.target ?? "",
      l.delta ?? "",
      l.status ?? "",
    ]),
  );
  return [header, ...rows].join("\n");
}
