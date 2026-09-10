// Keep the standalone deterministic gate independent of full-repository project
// discovery and database-backed tests. No browser transforms are needed here.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["ai/tests/nonAiEval.test.ts"],
    maxWorkers: 1,
  },
});
