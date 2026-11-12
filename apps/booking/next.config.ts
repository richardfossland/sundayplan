import type { NextConfig } from "next";

/**
 * The shared/sdk packages export raw TypeScript from src, so Next must
 * transpile them rather than expecting pre-built JS.
 */
const nextConfig: NextConfig = {
  // Last-bærende: `typescript` peker på TS 6-API-et (@typescript/typescript6),
  // som ikke har bin.tsc. Uten denne feiler `next build`. Se docs/DECISIONS.md ADR-001.
  experimental: { useTypeScriptCli: false },
  transpilePackages: ["@sundayplan/shared", "@sundayplan/sdk"],
};

export default nextConfig;
