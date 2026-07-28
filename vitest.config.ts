import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Native replacement for vite-tsconfig-paths; resolves the "@/*" alias
    // straight from tsconfig.json.
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/db/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    // The database tests share one PostgreSQL database. Each test runs inside a
    // transaction that is rolled back, but parallel files would still contend
    // for the same rows, so keep them serial.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
