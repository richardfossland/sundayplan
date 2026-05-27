/**
 * Public surface of `@sundayplan/shared`. The web app, the mobile app,
 * and the Edge Functions all import from here — never from individual
 * submodules — so we have one place to add deprecation guards if a
 * type changes shape.
 */

export * from "./types";
export * from "./tokens";
export * as schemas from "./schemas";
