import { afterEach, expect, it, vi } from "vitest";
import { HeuristicProvider } from "./provider";
import { OpenRouterProvider } from "./openrouter";
import { WebLLMProvider } from "./webllm";
import { MODELS } from "./models";
import { clearDataCache, setDbFetcher } from "../tools/dataClient";
afterEach(() => {
  clearDataCache();
  vi.unstubAllGlobals();
});
it.each(["bg", "en"] as const)(
  "E01/E18 deterministic scope and narration across providers: %s",
  async (lang) => {
    const external = vi.fn(() =>
      Promise.reject(Error("Model must not replace procurement facts")),
    );
    vi.stubGlobal("fetch", external);
    setDbFetcher(async (_route, params) => ({
      status: "success",
      query: JSON.parse(String(params.query)),
      totals: {
        records: 6,
        numerator: 3,
        positive_known: 4,
        evaluable: 4,
        missing_bids: 1,
        zero_bids: 1,
      },
    }));
    const cloud = new OpenRouterProvider(MODELS[0], {
      start: async () => ({ sessionToken: "fixture", questionId: "fixture" }),
      finish: async () => {},
    });
    const providers = [
      new HeuristicProvider(),
      cloud,
      new WebLLMProvider(MODELS[0]),
    ];
    const text =
      lang === "bg"
        ? "Какъв процент от договорите през 2026 са с 1 участник?"
        : "What share of contracts in 2026 have one bidder?";
    const responses = [];
    for (const provider of providers)
      responses.push(
        await provider.respond(text, { lang, election: "2024_06_09" }),
      );
    for (const response of responses) {
      expect(response.env?.procurement?.query).toEqual(
        responses[0].env?.procurement?.query,
      );
      expect(response.text).toContain("50%");
      expect(response.text).toContain("2026-01-01");
      expect(response.meta?.narratedBy).toBe("rules");
    }
    expect(external).not.toHaveBeenCalled();
  },
);
