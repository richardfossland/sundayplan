import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "components/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@sundayplan/shared": r("../../packages/shared/src/index.ts"),
      "@sundayplan/sdk": r("../../packages/sdk/src/index.ts"),
      "@sundayplan/auth": r("../../packages/auth/src/index.ts"),
      "@/": r("./") + "/",
    },
  },
});
