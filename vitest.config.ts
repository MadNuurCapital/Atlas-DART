import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Native replacement for vite-tsconfig-paths; resolves the "@/*" alias
    // straight from tsconfig.json.
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    include: [
      "tests/unit/**/*.test.ts",
      "tests/components/**/*.test.tsx",
      "tests/db/**/*.test.ts",
    ],
    exclude: ["tests/e2e/**", "node_modules/**"],
    // Node by default - only the component tests need a DOM, and they ask for
    // one with a `@vitest-environment jsdom` docblock. Booting jsdom for the
    // date and SQL suites would cost time for nothing.
    environment: "node",
    setupFiles: ["tests/components/setup.ts"],
    // The database tests share one PostgreSQL database. Each test runs inside a
    // transaction that is rolled back, but parallel files would still contend
    // for the same rows, so keep them serial.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
