/**
 * `@sundayplan/sdk` — the typed client used by web + mobile.
 *
 * Currently exports the scoring engine (pure functions, deterministic) and
 * the placeholder API client (to be wired to Supabase in Phase 1.3).
 */

export * from "./scoring";
export * from "./rationale-refiner";
export * from "./conflicts";
export * from "./autofill";
export * from "./balancedAutofill";
export * from "./swap";
export * from "./credentials";
export * from "./setlist-ai";
export * from "./comms";
export * from "./templates";
export * from "./serviceplan";
export * from "./serviceplan-bundle";
export * from "./serviceplan-assemble";
export * from "./serviceplan-fetcher";
export * from "./channels";
export * from "./quota";
export * from "./observability";
export * from "./providers/phone";
export { TwilioSmsProvider } from "./providers/twilio";
export { ResendEmailProvider } from "./providers/resend";
export { SmtpEmailProvider } from "./providers/smtp";
export * from "./reports";
export * from "./coverage";
export * from "./analytics";
export * from "./import";
export * from "./api";
