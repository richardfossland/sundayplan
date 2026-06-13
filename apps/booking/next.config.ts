import type { NextConfig } from "next";

/**
 * The shared/sdk packages export raw TypeScript from src, so Next must
 * transpile them rather than expecting pre-built JS.
 */
const nextConfig: NextConfig = {
  transpilePackages: ["@sundayplan/shared", "@sundayplan/sdk"],
};

export default nextConfig;
