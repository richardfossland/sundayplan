/**
 * Runtime-contract test for the swap-finder DATA LAYER (not the pure SDK brain,
 * which has its own unit tests). This pins the Supabase query contract that
 * `findReplacements` depends on — specifically the COLUMN NAMES it requests per
 * table. A PostgREST `select` of a column that doesn't exist on the table fails
 * the whole query (data → null), which would silently return ZERO candidates for
 * every swap. TypeScript cannot catch that: the column list is a plain string and
 * the client surface is structurally typed.
 *
 * Regression: `member` has no `max_assignments_per_month` column (the per-member
 * cap comes from `church_settings.default_max_assignments_per_month`, matching
 * lib/data/schedule.ts + autofill.ts). Selecting it broke every swap shortlist.
 */
import { describe, expect, it } from "vitest";
import { findReplacements } from "./swap";

// Columns that genuinely exist on each table in the migrations. Any select of a
// column outside these sets would error at runtime against real PostgREST.
const SCHEMA: Record<string, Set<string>> = {
  service: new Set(["id", "church_id", "name", "starts_at_utc", "template_id", "state", "was_streamed_flag", "notes"]),
  role: new Set(["id", "church_id", "team_id", "name", "skill_required", "required_credentials"]),
  assignment: new Set([
    "id", "church_id", "service_id", "role_id", "member_id", "service_item_id",
    "status", "score", "score_breakdown", "created_by", "responded_at",
  ]),
  member: new Set([
    "id", "church_id", "display_name", "household", "joined_at",
    "target_serves_per_month", "language", "status",
  ]),
  team_membership: new Set(["member_id", "role_id", "team_id", "skill_level", "is_key_person"]),
  church_settings: new Set([
    "church_id", "default_max_assignments_per_month", "unfilled_warn_days", "max_consecutive_sundays",
  ]),
};

/** Top-level columns from a PostgREST select string, ignoring embedded resources
 *  like `availability(...)` (those are joined relations, validated separately). */
function topLevelColumns(select: string): string[] {
  return select
    .replace(/\w+\([^)]*\)/g, "") // strip embedded resource selections
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && !c.endsWith(":"));
}

type Rows = Record<string, unknown>[];

/** Minimal fake of the supabase-js builder: records the requested columns and
 *  hands back canned rows; awaiting yields `{ data, error }`. */
function fakeClient(data: Record<string, Rows>, seen: { table: string; select: string }[]) {
  return {
    from(table: string) {
      return {
        select(cols: string) {
          seen.push({ table, select: cols });
          return Promise.resolve({ data: data[table] ?? [], error: null });
        },
      };
    },
  };
}

const SUNDAY = "2026-01-04T11:00:00.000Z";
const NOW = new Date("2025-12-28T00:00:00Z");

function baseData(): Record<string, Rows> {
  return {
    service: [{ id: "svc1", starts_at_utc: SUNDAY }],
    role: [{ id: "sound", skill_required: "capable" }],
    // The declining member "ava" holds the slot; "ben" is a trained sub.
    assignment: [{ service_id: "svc1", role_id: "sound", member_id: "ava", status: "accepted" }],
    member: [
      { id: "ava", display_name: "Ava", household: null, joined_at: null, target_serves_per_month: 2, availability: [] },
      { id: "ben", display_name: "Ben", household: null, joined_at: null, target_serves_per_month: 2, availability: [] },
    ],
    team_membership: [
      { member_id: "ava", role_id: "sound", skill_level: "capable", is_key_person: false },
      { member_id: "ben", role_id: "sound", skill_level: "capable", is_key_person: false },
    ],
    church_settings: [{ default_max_assignments_per_month: 3, unfilled_warn_days: 7, max_consecutive_sundays: 3 }],
  };
}

const TARGET = { id: "asg1", church_id: "c1", service_id: "svc1", role_id: "sound", member_id: "ava" };

describe("findReplacements — Supabase query contract", () => {
  it("only requests columns that exist in the schema (no bad column kills the query)", async () => {
    const seen: { table: string; select: string }[] = [];
    await findReplacements(fakeClient(baseData(), seen) as never, TARGET, NOW);

    expect(seen.length).toBeGreaterThan(0);
    for (const { table, select } of seen) {
      const known = SCHEMA[table];
      expect(known, `unexpected table queried: ${table}`).toBeDefined();
      for (const col of topLevelColumns(select)) {
        expect(known!.has(col), `${table}.select requested unknown column "${col}"`).toBe(true);
      }
    }
  });

  it("does NOT request member.max_assignments_per_month (column does not exist)", async () => {
    const seen: { table: string; select: string }[] = [];
    await findReplacements(fakeClient(baseData(), seen) as never, TARGET, NOW);
    const memberSelect = seen.find((s) => s.table === "member")?.select ?? "";
    expect(memberSelect).not.toContain("max_assignments_per_month");
  });

  it("ranks a trained, available substitute for the vacated slot", async () => {
    const seen: { table: string; select: string }[] = [];
    const ranked = await findReplacements(fakeClient(baseData(), seen) as never, TARGET, NOW);
    expect(ranked.map((r) => r.member_id)).toEqual(["ben"]);
  });
});
