import { describe, expect, it } from "vitest";
import { buildToolSystemPrompt } from "./prompts";
import { createRequire } from "node:module";
const { payload, MODEL } = createRequire(import.meta.url)(
  "../../functions/llm_security.js",
);
describe("production routing prompt contract", () => {
  for (const lang of ["en", "bg"] as const) {
    it(`${lang}: exposes required arguments and enum codes within the production input budget`, () => {
      const prompt = buildToolSystemPrompt(lang);
      expect(prompt).toContain('"tool":null');
      expect(prompt).toContain(
        'metric; required; metric; values=["commitments","expense_obligations","arrears"]',
      );
      expect(prompt).toContain("foreign_funded =");
      expect(prompt).not.toContain("- waterServices()");
      expect(() =>
        payload({
          model: MODEL,
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: "x".repeat(8000) },
          ],
          max_tokens: 120,
        }),
      ).not.toThrow();
    });
  }
});
