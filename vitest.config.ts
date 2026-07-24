import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/tests/**/*.test.ts", "apps/desktop/tests/**/*.test.ts"],
    environment: "node",
  },
});
