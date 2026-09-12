// Focused, hermetic review gate; avoids full-repository project discovery.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: [
      "ai/app/**/*.test.ts",
      "ai/orchestrator/router.prices.test.ts",
      "ai/render/links*.test.ts",
      "ai/tools/prices.product.test.ts",
      "ai/tools/person*.test.ts",
      "ai/tools/answerContext.test.ts",
      "ai/tools/presidential.test.ts",
    ],
    maxWorkers: 2,
  },
});
