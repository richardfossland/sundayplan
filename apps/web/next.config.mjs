/** @type {import('next').NextConfig} */
const nextConfig = {
  // The shared/sdk packages export raw TypeScript from src, so Next must
  // transpile them rather than expecting pre-built JS.
  transpilePackages: ["@sundayplan/shared", "@sundayplan/sdk"],
};

export default nextConfig;
