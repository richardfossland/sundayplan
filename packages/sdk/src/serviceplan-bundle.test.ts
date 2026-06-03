import { describe, expect, it } from "vitest";
import type { ServicePlan } from "./serviceplan";
import {
  BUNDLE_PRODUCER,
  SERVICEPLAN_BUNDLE_VERSION,
  readServicePlanBundle,
  serializeServicePlanBundle,
  writeServicePlanBundle,
  type ServicePlanBundle,
} from "./serviceplan-bundle";

/**
 * Dedicated coverage for the cross-app envelope contract (`serviceplan-bundle`).
 * The round-trip is also exercised in `serviceplan-assemble.test.ts`, but this
 * file pins *every* {@link readServicePlanBundle} guard individually, both
 * `writeServicePlanBundle` clock paths, and a committed golden v1 wire fixture
 * (NOT produced by the current writer) so any shape drift is caught — the
 * envelope is the wire format handed to SundayStage / SundayRec.
 */

// ── A minimal, hand-built canonical plan (no upstream assembly needed) ─────────

function makePlan(over: Partial<ServicePlan["service"]> = {}): ServicePlan {
  return {
    service: {
      id: "svc1",
      church_id: "ch1",
      name: "Sunday Morning",
      starts_at: "2026-09-13T09:00:00Z",
      state: "published",
      was_streamed: true,
      notes: null,
      ...over,
    },
    items: [
      {
        position: 1,
        kind: "welcome",
        title: "Welcome",
        song_ref: null,
        scripture_ref: null,
        key_override: null,
        duration_min: 5,
        notes: null,
      },
    ],
  };
}

// ── writeServicePlanBundle ────────────────────────────────────────────────────

describe("writeServicePlanBundle", () => {
  it("stamps version/producer/service_id and mirrors plan.service.id", () => {
    const plan = makePlan();
    const bundle = writeServicePlanBundle(plan);
    expect(bundle.version).toBe(SERVICEPLAN_BUNDLE_VERSION);
    expect(bundle.producer).toBe(BUNDLE_PRODUCER);
    expect(bundle.service_id).toBe("svc1");
    expect(bundle.service_id).toBe(bundle.plan.service.id);
    expect(bundle.plan).toBe(plan); // wraps, does not clone
  });

  it("injects generated_at from the supplied clock", () => {
    const bundle = writeServicePlanBundle(makePlan(), { now: () => "2026-09-12T20:00:00Z" });
    expect(bundle.generated_at).toBe("2026-09-12T20:00:00Z");
  });

  it("leaves generated_at null when no clock is injected (never reaches the wall clock)", () => {
    expect(writeServicePlanBundle(makePlan()).generated_at).toBeNull();
    expect(writeServicePlanBundle(makePlan(), {}).generated_at).toBeNull();
  });
});

// ── round-trip ────────────────────────────────────────────────────────────────

describe("write → serialize → JSON.parse → read round-trip", () => {
  it("recovers a structurally identical bundle with ok:true", () => {
    const plan = makePlan();
    const bundle = writeServicePlanBundle(plan, { now: () => "2026-09-12T20:00:00Z" });

    const json = serializeServicePlanBundle(bundle);
    const read = readServicePlanBundle(JSON.parse(json) as unknown);

    expect(read.ok).toBe(true);
    if (!read.ok) return; // narrow for TS
    expect(read.bundle).toEqual(bundle);
    expect(read.bundle.plan).toEqual(plan);
    expect(read.bundle.service_id).toBe(read.bundle.plan.service.id);
  });

  it("accepts a bundle whose generated_at is null", () => {
    const read = readServicePlanBundle(writeServicePlanBundle(makePlan()));
    expect(read.ok).toBe(true);
  });
});

// ── readServicePlanBundle — every validation branch ───────────────────────────

describe("readServicePlanBundle — validation guards", () => {
  /** A known-good envelope to mutate one field at a time. */
  const good = writeServicePlanBundle(makePlan(), { now: () => "2026-09-12T20:00:00Z" });

  function err(value: unknown): string {
    const r = readServicePlanBundle(value);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected a rejection");
    return r.error;
  }

  it("accepts the well-formed envelope", () => {
    expect(readServicePlanBundle(good).ok).toBe(true);
  });

  it("rejects non-objects (null, primitive, array)", () => {
    expect(err(null)).toBe("bundle is not an object");
    expect(err(undefined)).toBe("bundle is not an object");
    expect(err("nope")).toBe("bundle is not an object");
    expect(err(42)).toBe("bundle is not an object");
    // arrays are objects in JS but have no string `version` → caught one guard down
    expect(err([])).toBe("missing or non-numeric version");
  });

  it("rejects a missing or non-numeric version", () => {
    expect(err({ ...good, version: undefined })).toBe("missing or non-numeric version");
    expect(err({ ...good, version: "1" })).toBe("missing or non-numeric version");
  });

  it("rejects a version newer than this build understands", () => {
    const e = err({ ...good, version: SERVICEPLAN_BUNDLE_VERSION + 1 });
    expect(e).toContain("unsupported bundle version");
    expect(e).toContain(String(SERVICEPLAN_BUNDLE_VERSION + 1));
    expect(e).toContain(`up to ${SERVICEPLAN_BUNDLE_VERSION}`);
  });

  it("rejects a missing or empty producer", () => {
    expect(err({ ...good, producer: undefined })).toBe("missing producer");
    expect(err({ ...good, producer: "" })).toBe("missing producer");
    expect(err({ ...good, producer: 5 })).toBe("missing producer");
  });

  it("rejects a generated_at that is neither string nor null", () => {
    expect(err({ ...good, generated_at: 12345 })).toBe(
      "generated_at must be a string or null",
    );
  });

  it("rejects a missing service_id", () => {
    expect(err({ ...good, service_id: undefined })).toBe("missing service_id");
    expect(err({ ...good, service_id: 7 })).toBe("missing service_id");
  });

  it("rejects a missing or non-object plan", () => {
    expect(err({ ...good, plan: undefined })).toBe("missing plan");
    expect(err({ ...good, plan: null })).toBe("missing plan");
    expect(err({ ...good, plan: "x" })).toBe("missing plan");
  });

  it("rejects a missing or non-object plan.service", () => {
    expect(err({ ...good, plan: { items: [] } })).toBe("missing plan.service");
    expect(err({ ...good, plan: { service: null, items: [] } })).toBe("missing plan.service");
  });

  it("rejects a non-array plan.items", () => {
    expect(err({ ...good, plan: { service: good.plan.service, items: "nope" } })).toBe(
      "plan.items must be an array",
    );
    expect(err({ ...good, plan: { service: good.plan.service } })).toBe(
      "plan.items must be an array",
    );
  });

  it("rejects an envelope service_id that disagrees with plan.service.id", () => {
    const e = err({ ...good, service_id: "other" });
    expect(e).toContain("service_id mismatch");
    expect(e).toContain("other");
    expect(e).toContain("svc1");
  });

  it("tolerates extra/unknown envelope keys (structural-only validation)", () => {
    expect(readServicePlanBundle({ ...good, extra: "ignored" }).ok).toBe(true);
  });
});

// ── Golden v1 wire fixture (forward/backward-compat regression) ───────────────

/**
 * A committed, hand-authored serialization of a version-1 bundle. It is NOT
 * produced by the current writer, so it pins the on-the-wire shape SundayStage /
 * SundayRec already expect: if a refactor silently renames or drops an envelope
 * field, this fixture stops parsing even though the round-trip test (which uses
 * the current writer for both ends) would still pass.
 */
const GOLDEN_V1_BUNDLE = JSON.stringify({
  version: 1,
  producer: "sundayplan",
  generated_at: "2026-09-12T20:00:00Z",
  service_id: "svc-golden",
  plan: {
    service: {
      id: "svc-golden",
      church_id: "ch-golden",
      name: "Golden Service",
      starts_at: "2026-09-13T09:00:00Z",
      state: "published",
      was_streamed: false,
      notes: null,
    },
    items: [
      {
        position: 1,
        kind: "welcome",
        title: "Welcome",
        song_ref: null,
        scripture_ref: null,
        key_override: null,
        duration_min: 5,
        notes: null,
      },
      {
        position: 2,
        kind: "song",
        title: "10,000 Reasons",
        song_ref: {
          song_id: "song1",
          sundaysong_id: "ss-999",
          title: "10,000 Reasons",
          ccli_song_id: "6016351",
          tono_work_id: null,
        },
        scripture_ref: null,
        key_override: "A",
        duration_min: 0,
        notes: null,
      },
    ],
  },
});

describe("versioned wire format compatibility", () => {
  it("the assumed current version is 1 (bump this test + the golden fixture together)", () => {
    expect(SERVICEPLAN_BUNDLE_VERSION).toBe(1);
  });

  it("accepts the committed golden v1 bundle string", () => {
    const read = readServicePlanBundle(JSON.parse(GOLDEN_V1_BUNDLE) as unknown);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.bundle.service_id).toBe("svc-golden");
    expect(read.bundle.plan.items).toHaveLength(2);
    expect(read.bundle.plan.items[1].song_ref?.sundaysong_id).toBe("ss-999");
  });

  it("rejects a golden bundle bumped one version past what this build understands", () => {
    const future = JSON.parse(GOLDEN_V1_BUNDLE) as ServicePlanBundle;
    future.version = SERVICEPLAN_BUNDLE_VERSION + 1;
    const read = readServicePlanBundle(future);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error).toContain("unsupported bundle version");
  });
});
