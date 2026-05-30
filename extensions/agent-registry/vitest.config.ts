import * as fc from "fast-check";
import { defineConfig } from "vitest/config";

// Configure fast-check global defaults for all property tests in this package.
fc.configureGlobal({ numRuns: 100 });

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
});
