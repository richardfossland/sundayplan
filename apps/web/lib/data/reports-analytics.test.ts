/**
 * Data-layer test for the Phase 12 volunteer-analytics fetchers
 * (getChurnInputs / getRoleBalanceInputs). Uses an in-memory fake of the
 * Supabase client (no live DB), mocked at the module boundaries the data layer
 * imports. These are mapping-only functions — all the math is unit-tested in the
 * SDK — so this pins the SHAPE the SDK engines receive:
 *
 *  • member.status is narrowed to the SDK's active|inactive|archived union;
 *  • archived services drop out of the serve history;
 *  • role.recruit_target becomes a RoleTarget only when non-null;
 *  • team_membership rows become RoleQualification with active = member active;
 *  • a missing church short-circuits to empty (no client call).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

type Rows = Record<string, unknown>[];

let DATA: Record<string, Rows> = {};
let CHURCH_ID: string | null = "c1";

// Chainable fake: .eq()/.in() return the same thenable; awaiting yields
// { data, error }. Filters are NOT applied (the test supplies already-scoped
// rows) — we only assert the mapping, matching the existing data-layer tests.
function makeBuilder(table: string) {
  const result = { data: DATA[table] ?? [], error: null };
  const thenable = {
    eq() {
      return thenable;
    },
    in() {
      return thenable;
    },
    order() {
      return thenable;
    },
    then(resolve: (v: typeof result) => unknown) {
      return Promise.resolve(result).then(resolve);
    },
  };
  return thenable;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      return {
        select() {
          return makeBuilder(table);
        },
      };
    },
  }),
}));

vi.mock("@/lib/data/church", () => ({
  getCurrentChurchId: async () => CHURCH_ID,
}));

import { getChurnInputs, getRoleBalanceInputs } from "./reports";

beforeEach(() => {
  CHURCH_ID = "c1";
  DATA = {};
});

// ── getChurnInputs ─────────────────────────────────────────────────────────

describe("getChurnInputs", () => {
  it("narrows member.status to the SDK union and maps join date", async () => {
    DATA = {
      member: [
        { id: "m1", display_name: "Ann", joined_at: "2026-01-01", status: "active" },
        { id: "m2", display_name: "Bo", joined_at: null, status: "inactive" },
        { id: "m3", display_name: "Cy", joined_at: "2025-01-01", status: "archived" },
        // a status outside the union must fall back to 'inactive' (never retained)
        { id: "m4", display_name: "Di", joined_at: "2026-01-01", status: "weird" },
      ],
      assignment: [],
    };
    const { members } = await getChurnInputs();
    expect(members).toEqual([
      { memberId: "m1", name: "Ann", joinedAtLocal: "2026-01-01", status: "active" },
      { memberId: "m2", name: "Bo", joinedAtLocal: null, status: "inactive" },
      { memberId: "m3", name: "Cy", joinedAtLocal: "2025-01-01", status: "archived" },
      { memberId: "m4", name: "Di", joinedAtLocal: "2026-01-01", status: "inactive" },
    ]);
  });

  it("keeps non-archived serves and drops archived/null-service ones", async () => {
    DATA = {
      member: [],
      assignment: [
        { member_id: "m1", service: { starts_at_utc: "2026-05-01T10:00:00Z", state: "played" } },
        { member_id: "m1", service: { starts_at_utc: "2026-06-01T10:00:00Z", state: "archived" } },
        { member_id: "m2", service: null },
      ],
    };
    const { assignments } = await getChurnInputs();
    expect(assignments).toEqual([{ memberId: "m1", serviceDateLocal: "2026-05-01T10:00:00Z" }]);
  });

  it("short-circuits to empty when no church is active (no mapping)", async () => {
    CHURCH_ID = null;
    DATA = { member: [{ id: "x", display_name: "X", joined_at: null, status: "active" }] };
    expect(await getChurnInputs()).toEqual({ members: [], assignments: [] });
  });
});

// ── getRoleBalanceInputs ─────────────────────────────────────────────────────

describe("getRoleBalanceInputs", () => {
  it("maps roles + team name, and emits targets only for non-null recruit_target", async () => {
    DATA = {
      role: [
        { id: "r1", name: "Drums", recruit_target: 2, team: { name: "Band" } },
        { id: "r2", name: "Sound", recruit_target: null, team: { name: "Tech" } },
        { id: "r3", name: "Greeter", recruit_target: 0, team: null }, // 0 is a real target
      ],
      team_membership: [],
    };
    const { roles, targets } = await getRoleBalanceInputs();
    expect(roles).toEqual([
      { roleId: "r1", roleName: "Drums", teamName: "Band" },
      { roleId: "r2", roleName: "Sound", teamName: "Tech" },
      { roleId: "r3", roleName: "Greeter", teamName: null },
    ]);
    // r2 (null) excluded; r3 (0) included.
    expect(targets).toEqual([
      { roleId: "r1", target: 2 },
      { roleId: "r3", target: 0 },
    ]);
  });

  it("maps team_membership to qualifications with active = member active", async () => {
    DATA = {
      role: [{ id: "r1", name: "Drums", recruit_target: 1, team: { name: "Band" } }],
      team_membership: [
        { role_id: "r1", member_id: "m1", member: { status: "active" } },
        { role_id: "r1", member_id: "m2", member: { status: "inactive" } },
        { role_id: "r1", member_id: "m3", member: null }, // unknown → inactive
      ],
    };
    const { qualifications } = await getRoleBalanceInputs();
    expect(qualifications).toEqual([
      { roleId: "r1", memberId: "m1", active: true },
      { roleId: "r1", memberId: "m2", active: false },
      { roleId: "r1", memberId: "m3", active: false },
    ]);
  });

  it("skips the membership query when there are no roles", async () => {
    DATA = { role: [], team_membership: [{ role_id: "x", member_id: "y", member: { status: "active" } }] };
    const out = await getRoleBalanceInputs();
    expect(out.roles).toEqual([]);
    expect(out.qualifications).toEqual([]); // not pulled, even though DATA has rows
    expect(out.targets).toEqual([]);
  });

  it("short-circuits to empty when no church is active", async () => {
    CHURCH_ID = null;
    DATA = { role: [{ id: "r1", name: "Drums", recruit_target: 1, team: null }] };
    expect(await getRoleBalanceInputs()).toEqual({ roles: [], qualifications: [], targets: [] });
  });
});
