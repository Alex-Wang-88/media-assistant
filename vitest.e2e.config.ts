import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/desktop/tests/**/*.e2e.test.ts"],
    passWithNoTests: true,
    testTimeout: 30_000,
  },
});
