/**
 * Phase 7 (bridge) — the cross-app `ServicePlan` *bundle* envelope + its pure
 * write/read round-trip helper.
 *
 * `serviceplan.ts` produces the canonical {@link ServicePlan} shape. To hand it
 * to another app in the suite (SundayStage consumes it; SundayRec metadata-links
 * back) we wrap it in a small, versioned, self-describing envelope so a reader
 * can sanity-check what it received before trusting it. This module is the
 * contract for that envelope plus the pure (de)serialization — no I/O, no clock
 * unless one is injected.
 *
 * The envelope MIRRORS `sunday-contracts`; converge once that platform package
 * is published. We can't import `@sunday/*` yet, so it's re-declared locally
 * behind this note. Do not add a cross-repo path dependency.
 */

import type { ServicePlan } from "./serviceplan";

/** Current bundle schema version. Bump on any breaking envelope change. */
export const SERVICEPLAN_BUNDLE_VERSION = 1 as const;

/** The app that produced a bundle (so a reader can attribute provenance). */
export const BUNDLE_PRODUCER = "sundayplan" as const;

/**
 * A versioned envelope around a {@link ServicePlan}, ready to write to disk or a
 * transport. mirrors sunday-contracts; converge once published.
 */
export interface ServicePlanBundle {
  /** Envelope schema version — {@link SERVICEPLAN_BUNDLE_VERSION} at write time. */
  version: number;
  /** Producing app, for provenance. Always {@link BUNDLE_PRODUCER} here. */
  producer: string;
  /** ISO-8601 UTC timestamp the bundle was written, when a clock was supplied. */
  generated_at: string | null;
  /** The service id this bundle carries (mirrors `plan.service.id`). */
  service_id: string;
  /** The canonical plan payload. */
  plan: ServicePlan;
}

export interface WriteBundleOptions {
  /**
   * Injected clock returning an ISO-8601 UTC string. Kept injectable so the
   * helper stays pure + deterministic in tests. When omitted, `generated_at`
   * is left null rather than reaching for the real wall clock.
   */
  now?: () => string;
}

/**
 * Wrap a {@link ServicePlan} in a {@link ServicePlanBundle} envelope. Pure: the
 * only non-determinism (the timestamp) is injected via `opts.now`.
 */
export function writeServicePlanBundle(
  plan: ServicePlan,
  opts: WriteBundleOptions = {},
): ServicePlanBundle {
  return {
    version: SERVICEPLAN_BUNDLE_VERSION,
    producer: BUNDLE_PRODUCER,
    generated_at: opts.now ? opts.now() : null,
    service_id: plan.service.id,
    plan,
  };
}

/** Discriminated result of {@link readServicePlanBundle}. */
export type ReadBundleResult =
  | { ok: true; bundle: ServicePlanBundle }
  | { ok: false; error: string };

/**
 * Validate + unwrap a value that claims to be a {@link ServicePlanBundle} (e.g.
 * `JSON.parse` output from a written bundle). Structural-only: it checks the
 * envelope is intact and self-consistent (version known, producer present,
 * `service_id` matches `plan.service.id`) rather than deep-validating every
 * canonical item — that's the consumer's domain. Returns a discriminated result
 * instead of throwing so a reader can degrade gracefully.
 */
export function readServicePlanBundle(value: unknown): ReadBundleResult {
  if (value == null || typeof value !== "object") {
    return { ok: false, error: "bundle is not an object" };
  }
  const b = value as Record<string, unknown>;

  if (typeof b.version !== "number") {
    return { ok: false, error: "missing or non-numeric version" };
  }
  if (b.version > SERVICEPLAN_BUNDLE_VERSION) {
    return {
      ok: false,
      error: `unsupported bundle version ${b.version} (this build understands up to ${SERVICEPLAN_BUNDLE_VERSION})`,
    };
  }
  if (typeof b.producer !== "string" || b.producer.length === 0) {
    return { ok: false, error: "missing producer" };
  }
  if (b.generated_at != null && typeof b.generated_at !== "string") {
    return { ok: false, error: "generated_at must be a string or null" };
  }
  if (typeof b.service_id !== "string") {
    return { ok: false, error: "missing service_id" };
  }

  const plan = b.plan as ServicePlan | undefined;
  if (plan == null || typeof plan !== "object") {
    return { ok: false, error: "missing plan" };
  }
  if (plan.service == null || typeof plan.service !== "object") {
    return { ok: false, error: "missing plan.service" };
  }
  if (!Array.isArray(plan.items)) {
    return { ok: false, error: "plan.items must be an array" };
  }
  if (plan.service.id !== b.service_id) {
    return {
      ok: false,
      error: `service_id mismatch: envelope ${b.service_id} vs plan ${plan.service.id}`,
    };
  }

  return { ok: true, bundle: b as unknown as ServicePlanBundle };
}

/**
 * Serialize a bundle to a JSON string. Stable wrapper over `JSON.stringify`
 * (kept here so a future change to encoding — pretty-print, canonical key
 * order — lives in one place).
 */
export function serializeServicePlanBundle(bundle: ServicePlanBundle): string {
  return JSON.stringify(bundle);
}
