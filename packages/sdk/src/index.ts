/**
 * `@sundayplan/sdk` — the typed client used by web + mobile.
 *
 * Currently exports the scoring engine (pure functions, deterministic) and
 * the placeholder API client (to be wired to Supabase in Phase 1.3).
 */

export * from "./scoring";
export * from "./conflicts";
export * from "./autofill";
export * from "./comms";
export * from "./channels";
export * from "./reports";
export * from "./coverage";
export * from "./import";
export * from "./api";
