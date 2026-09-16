import { describe, expect, it } from "vitest";
import { buildToolSystemPrompt, FORMAT_ANCHOR_TOOLS } from "./prompts";
import { createRequire } from "node:module";
import {
  buildContext,
  CLOUD_BUDGET,
  renderRoutingContext,
  type TurnMemory,
} from "./memory";
import {
  routingMessages,
  withinBudget,
  withinCeiling,
} from "../llm/promptBudget";
import { preselectCandidates } from "./toolPreselector";
import { TOOLS, TOOLS_BY_NAME } from "../tools/registry";
import { narrowCatalogueForBudget } from "../llm/openrouter";
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

  it("survives the REAL maximum context, not a placeholder", () => {
    // The assertion above uses an 8,000-character filler, which passes with room to
    // spare and therefore cannot see the cliff it is supposed to guard. This uses the
    // largest request the system actually assembles — a BG window saturated at
    // CLOUD_BUDGET — and pins the honest outcome: a typical window FITS the budget,
    // the saturated one does NOT (so the narrowing path is live today), and even that
    // one stays inside the proxy's hard ceiling.
    const thread = (repeat: number): TurnMemory[] =>
      Array.from({ length: 8 }, () => ({
        question:
          "Каква беше избирателната активност и колко гласа взе ГЕРБ в Русе на последните парламентарни избори? ".repeat(
            repeat,
          ),
        tool: "partyResult",
        args: { party: "ГЕРБ" },
        gist: "Активност — 40.5%; ГЕРБ — гласове: 63,400; дял: 25.3%; секции: 412; область: Русе",
        lang: "bg" as const,
      }));
    const content = (repeat: number) => {
      const context = renderRoutingContext(
        buildContext(thread(repeat), CLOUD_BUDGET),
        "bg",
      );
      return `${context}\n\nТекущ въпрос: Каква беше активността и колко гласа взе ГЕРБ в Русе?`;
    };
    const typical = routingMessages("bg", undefined, content(1));
    expect(withinBudget(typical)).toBe(true);
    const saturated = routingMessages("bg", undefined, content(4));
    expect(withinBudget(saturated)).toBe(false);
    expect(withinCeiling(saturated)).toBe(true);
    // And the request the provider would actually SEND for the saturated case fits.
    const kept = narrowCatalogueForBudget(
      "Каква е инфлацията?",
      "bg",
      content(4),
    );
    expect(kept).toBeDefined();
    expect(withinBudget(routingMessages("bg", kept, content(4)))).toBe(true);
  });

  for (const lang of ["en", "bg"] as const) {
    it(`${lang}: a candidate set restricts the catalogue without breaking its contract`, () => {
      const candidates = preselectCandidates("Каква е инфлацията?")
        .slice(0, 14)
        .map((c) => TOOLS_BY_NAME[c.tool]);
      const prompt = buildToolSystemPrompt(lang, candidates);
      // The output contract the model must follow is still stated.
      expect(prompt).toContain('"tool":null');
      expect(prompt).toContain("args");
      // Only the candidates are declared.
      const listed = new Set([
        ...candidates.map((t) => t.name),
        ...FORMAT_ANCHOR_TOOLS,
      ]);
      for (const tool of TOOLS)
        if (!listed.has(tool.name))
          expect(prompt, `${lang} leaked ${tool.name}`).not.toContain(
            `- ${tool.name} —`,
          );
      // ...and it fits the ceiling with the real maximum context attached.
      const context = renderRoutingContext(
        buildContext([], CLOUD_BUDGET),
        lang,
      );
      const messages = routingMessages(
        lang,
        [...listed],
        context || "question",
      );
      expect(withinCeiling(messages)).toBe(true);
      expect(withinBudget(messages)).toBe(true);
      expect(
        Buffer.byteLength(prompt),
        `${lang} narrowed prompt is not smaller than the full catalogue`,
      ).toBeLessThan(Buffer.byteLength(buildToolSystemPrompt(lang)) / 3);
    });
  }
});
