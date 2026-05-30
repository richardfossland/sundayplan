/**
 * Phase 11 — pure operational reports beyond licensing: volunteer balance
 * (is the load fair?) and service coverage (are required slots filled?).
 *
 * No I/O, no Date.now(): the data layer supplies normalized rows; these group
 * and summarize them. Dates are compared on the local YYYY-MM-DD portion,
 * matching the licensing reports in reports.ts.
 */

// ── Shared helpers ──────────────────────────────────────────────────────────

function localDate(iso: string): string {
  return iso.slice(0, 10);
}

function inRange(iso: string, from: string, to: string): boolean {
  const d = localDate(iso);
  return d >= localDate(from) && d < localDate(to);
}

/** Whole calendar months spanned by `[from, to)`, at least 1. */
export function monthsInRange(from: string, to: string): number {
  const [fy, fm] = localDate(from).split("-").map(Number);
  const [ty, tm] = localDate(to).split("-").map(Number);
  const diff = (ty * 12 + tm) - (fy * 12 + fm);
  return Math.max(1, diff);
}

// ── Volunteer balance ───────────────────────────────────────────────────────

/** One "member committed to a service" row (declined/removed already excluded). */
export interface ServeRow {
  memberId: string;
  name: string;
  /** member's monthly target, or null to fall back to the church default below */
  targetPerMonth: number | null;
  serviceId: string;
  serviceDateLocal: string;
}

export interface VolunteerBalanceLine {
  memberId: string;
  name: string;
  /** assignments committed in range */
  serves: number;
  /** distinct services served in range */
  services: number;
  targetPerMonth: number | null;
  /** target × months in range, rounded; null when no target is known */
  expectedServes: number | null;
  /** serves − expectedServes; negative = under-served, positive = over-served */
  delta: number | null;
}

export interface VolunteerBalanceReport {
  from: string;
  to: string;
  months: number;
  lines: VolunteerBalanceLine[];
  totals: { serves: number; activeVolunteers: number; averageServes: number };
}

/**
 * Build the volunteer-balance report. `defaultTargetPerMonth` (the church
 * setting) fills in for members without a personal target.
 */
export function buildVolunteerBalance(
  rows: ServeRow[],
  from: string,
  to: string,
  defaultTargetPerMonth: number | null = null,
): VolunteerBalanceReport {
  const months = monthsInRange(from, to);
  const byMember = new Map<string, ServeRow[]>();
  for (const r of rows) {
    if (!inRange(r.serviceDateLocal, from, to)) continue;
    const list = byMember.get(r.memberId);
    if (list) list.push(r);
    else byMember.set(r.memberId, [r]);
  }

  const lines: VolunteerBalanceLine[] = [];
  for (const [memberId, group] of byMember) {
    const first = group[0];
    const target = first.targetPerMonth ?? defaultTargetPerMonth;
    const expected = target == null ? null : Math.round(target * months);
    lines.push({
      memberId,
      name: first.name,
      serves: group.length,
      services: new Set(group.map((g) => g.serviceId)).size,
      targetPerMonth: first.targetPerMonth,
      expectedServes: expected,
      delta: expected == null ? null : group.length - expected,
    });
  }

  // Most over-served first, then by name — the planner scans the top for burnout.
  lines.sort((a, b) => b.serves - a.serves || a.name.localeCompare(b.name));

  const totalServes = lines.reduce((n, l) => n + l.serves, 0);
  return {
    from,
    to,
    months,
    lines,
    totals: {
      serves: totalServes,
      activeVolunteers: lines.length,
      averageServes: lines.length === 0 ? 0 : totalServes / lines.length,
    },
  };
}

// ── Service coverage ─────────────────────────────────────────────────────────

/** One role requirement on a service, with how many slots are filled. */
export interface CoverageRow {
  serviceId: string;
  serviceName: string;
  serviceDateLocal: string;
  roleId: string;
  roleName: string;
  required: number;
  filled: number;
}

export interface CoverageGap {
  roleId: string;
  role: string;
  missing: number;
}

export interface ServiceCoverageLine {
  serviceId: string;
  name: string;
  date: string;
  requiredSlots: number;
  filledSlots: number;
  /** filledSlots / requiredSlots, capped at 1; 1 when nothing is required */
  coverage: number;
  gaps: CoverageGap[];
}

export interface ServiceCoverageReport {
  from: string;
  to: string;
  lines: ServiceCoverageLine[];
  totals: {
    requiredSlots: number;
    filledSlots: number;
    coverage: number;
    fullyCovered: number;
    servicesWithGaps: number;
  };
}

/** Build the per-service coverage report from role-requirement rows. */
export function buildServiceCoverage(
  rows: CoverageRow[],
  from: string,
  to: string,
): ServiceCoverageReport {
  // service id → { meta, requirement rows }
  const byService = new Map<string, { name: string; date: string; reqs: CoverageRow[] }>();
  for (const r of rows) {
    if (!inRange(r.serviceDateLocal, from, to)) continue;
    let svc = byService.get(r.serviceId);
    if (!svc) {
      svc = { name: r.serviceName, date: localDate(r.serviceDateLocal), reqs: [] };
      byService.set(r.serviceId, svc);
    }
    svc.reqs.push(r);
  }

  const lines: ServiceCoverageLine[] = [];
  for (const [serviceId, svc] of byService) {
    let required = 0;
    let filledCapped = 0;
    const gaps: CoverageGap[] = [];
    for (const req of svc.reqs) {
      required += req.required;
      const filled = Math.min(req.filled, req.required);
      filledCapped += filled;
      if (req.filled < req.required) {
        gaps.push({ roleId: req.roleId, role: req.roleName, missing: req.required - req.filled });
      }
    }
    gaps.sort((a, b) => b.missing - a.missing || a.role.localeCompare(b.role));
    lines.push({
      serviceId,
      name: svc.name,
      date: svc.date,
      requiredSlots: required,
      filledSlots: filledCapped,
      coverage: required === 0 ? 1 : filledCapped / required,
      gaps,
    });
  }

  // Soonest service first.
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  const requiredSlots = lines.reduce((n, l) => n + l.requiredSlots, 0);
  const filledSlots = lines.reduce((n, l) => n + l.filledSlots, 0);
  return {
    from,
    to,
    lines,
    totals: {
      requiredSlots,
      filledSlots,
      coverage: requiredSlots === 0 ? 1 : filledSlots / requiredSlots,
      fullyCovered: lines.filter((l) => l.gaps.length === 0).length,
      servicesWithGaps: lines.filter((l) => l.gaps.length > 0).length,
    },
  };
}
