import { expect, it, vi } from "vitest";
import { dispatchPrompt } from "./dispatchPrompt";
import type { LLMProvider } from "../llm/provider";
import { toChatQuestionIntent } from "./questionAdapter";
import { SUGGESTIONS } from "./suggestions";
it("every click bypasses text routing and preserves its declared parameters", async () => {
  const runChoice = vi.fn().mockResolvedValue({ text: "", env: null });
  const respond = vi.fn();
  const provider = { runChoice, respond } as unknown as LLMProvider;
  for (const s of SUGGESTIONS)
    for (const lang of ["bg", "en"] as const) {
      const intent = toChatQuestionIntent(s.questionId, lang, s.parameters);
      const ctx = { lang, election: "2026_04_19" };
      await dispatchPrompt(
        provider,
        s[lang],
        ctx,
        undefined,
        undefined,
        intent,
      );
      expect(runChoice).toHaveBeenLastCalledWith(
        intent.tool,
        intent.args,
        ctx,
        undefined,
      );
    }
  expect(respond).not.toHaveBeenCalled();
});
it("typed input retains conversation context through free-text routing", async () => {
  const respond = vi.fn().mockResolvedValue({ text: "", env: null });
  const provider = { respond } as unknown as LLMProvider;
  const ctx = { lang: "bg" as const, election: "2026_04_19" };
  const options = { prev: { tool: "budgetOverview", args: { year: 2025 } } };
  await dispatchPrompt(provider, "а през 2024?", ctx, undefined, options);
  expect(respond).toHaveBeenCalledWith("а през 2024?", ctx, undefined, options);
});
