/**
 * Data-layer test for the auto-fill slot builder — specifically the
 * cumulative-window-prior wiring that feeds `balancedAutoFill`. Uses an
 * in-memory fake of the Supabase client (no live DB), mocked at the module
 * boundary the data layer imports.
 *
 * Invariants pinned here:
 *  • `withWindowPriors` attaches `window_serves_prior` = the count of a member's
 *    ACTIVE assignments across the whole window (declined/removed excluded).
 *  • Default (no option) attaches NO prior — byte-identical candidate shape to
 *    the original greedy path, so existing behaviour is unchanged.
 *  • The prior count never leaks declined/removed assignments.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

type Rows = Record<string, unknown>[];

let DATA: Record<string, Rows> = {};

// A chainable fake of the supabase-js query builder. `.select()` returns a
// thenable that ALSO exposes `.order()` (which returns the same thenable), so
// both `from(t).select(c)` and `from(t).select(c).order(x)` resolve to
// `{ data, error }`.
function makeBuilder(table: string) {
  const result = { data: DATA[table] ?? [], error: null };
  // `.maybeSingle()` resolves to the first row (or null) — used for
  // church_settings (a single-row-per-church table).
  const singleResult = {
    data: (DATA[table] ?? [])[0] ?? null,
    error: null,
  };
  const thenable = {
    order() {
      return thenable;
    },
    maybeSingle() {
      return Promise.resolve(singleResult);
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

import { buildAutoFillSlots } from "./autofill";

const FUTURE = "2026-12-13T11:00:00.000Z";
const NOW = new Date("2026-01-01T00:00:00Z");

/** One open service "svc2" with role "sound"; "svc1" is already fully filled. */
function baseData(): Record<string, Rows> {
  return {
    service: [
      { id: "svc1", starts_at_utc: "2026-12-06T11:00:00.000Z" },
      { id: "svc2", starts_at_utc: FUTURE },
    ],
    role: [{ id: "sound", skill_required: "capable", required_credentials: null }],
    // ava is actively booked on svc1 (sound). ben has a DECLINED booking on
    // svc1 (must NOT count). Both are trained for sound and free for svc2.
    assignment: [
      { service_id: "svc1", role_id: "sound", member_id: "ava", status: "accepted" },
      { service_id: "svc1", role_id: "other", member_id: "ben", status: "declined" },
    ],
    member: [
      { id: "ava", joined_at: null, target_serves_per_month: 2, availability: [] },
      { id: "ben", joined_at: null, target_serves_per_month: 2, availability: [] },
    ],
    team_membership: [
      { member_id: "ava", role_id: "sound", skill_level: "capable" },
      { member_id: "ben", role_id: "sound", skill_level: "capable" },
    ],
    member_credential: [],
  };
}

beforeEach(() => {
  DATA = baseData();
});

describe("buildAutoFillSlots — window-prior wiring", () => {
  it("attaches window_serves_prior reflecting active assignments when opted in", async () => {
    const { slots } = await buildAutoFillSlots(NOW, { withWindowPriors: true });
    // svc1 is fully filled (sound→ava active) so only svc2 produces a slot.
    const svc2 = slots.find((s) => s.service_id === "svc2");
    expect(svc2).toBeDefined();
    const byMember = new Map(svc2!.candidates.map((c) => [c.member_id, c.window_serves_prior]));
    // ava already holds 1 active serve (svc1); ben's only booking was declined.
    expect(byMember.get("ava")).toBe(1);
    expect(byMember.get("ben")).toBe(0);
  });

  it("attaches NO prior by default (default-safe, original behaviour)", async () => {
    const { slots } = await buildAutoFillSlots(NOW);
    const svc2 = slots.find((s) => s.service_id === "svc2")!;
    for (const c of svc2.candidates) {
      expect(c.window_serves_prior).toBeUndefined();
    }
  });

  it("does not count declined/removed assignments toward the prior", async () => {
    DATA = baseData();
    // Give ben an additional REMOVED assignment — still must not count.
    (DATA.assignment as Rows).push({
      service_id: "svc1",
      role_id: "sound2",
      member_id: "ben",
      status: "removed",
    });
    const { slots } = await buildAutoFillSlots(NOW, { withWindowPriors: true });
    const svc2 = slots.find((s) => s.service_id === "svc2")!;
    const ben = svc2.candidates.find((c) => c.member_id === "ben");
    expect(ben?.window_serves_prior).toBe(0);
  });
});

describe("buildAutoFillSlots — rest-window wiring", () => {
  it("returns the church's min_rest_days (0 when unset)", async () => {
    const { minRestDays } = await buildAutoFillSlots(NOW);
    expect(minRestDays).toBe(0);
  });

  it("reads min_rest_days from church_settings when present", async () => {
    DATA = baseData();
    DATA.church_settings = [{ min_rest_days: 6 }];
    const { minRestDays } = await buildAutoFillSlots(NOW);
    expect(minRestDays).toBe(6);
  });

  it("attaches committed_times = other active service instants the member holds", async () => {
    DATA = baseData();
    const { slots } = await buildAutoFillSlots(NOW);
    const svc2 = slots.find((s) => s.service_id === "svc2")!;
    // ava is actively booked on svc1 (2026-12-06) → that instant is committed.
    const ava = svc2.candidates.find((c) => c.member_id === "ava");
    expect(ava?.committed_times).toEqual([new Date("2026-12-06T11:00:00.000Z").getTime()]);
    // ben's only svc1 booking was declined → no committed time.
    const ben = svc2.candidates.find((c) => c.member_id === "ben");
    expect(ben?.committed_times).toEqual([]);
  });
});
