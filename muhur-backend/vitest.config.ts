import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    testTimeout: 15000,
    // Test files share one live Postgres DB with no per-file isolation
    // (each calls resetDb() against the same tables). Running files in
    // parallel causes cross-file races (FK violations, missing rows).
    fileParallelism: false,
  },
});
