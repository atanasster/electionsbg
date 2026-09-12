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
  "funding scope is identical across all providers: %s",
  async (lang) => {
    const external = vi.fn(() =>
      Promise.reject(Error("Model cannot replace funding facts")),
    );
    vi.stubGlobal("fetch", external);
    setDbFetcher(async (_route, params) => ({
      status: "success",
      query: JSON.parse(String(params.query)),
      revision: "fixture",
      totals: { records: 3, amount: 100, known_amount: 3, known_paid: 3 },
      rows: [],
    }));
    const cloud = new OpenRouterProvider(MODELS[0], {
      start: async () => ({ sessionToken: "fixture", questionId: "fixture" }),
      finish: async () => {},
    });
    const responses = [];
    for (const provider of [
      new HeuristicProvider(),
      cloud,
      new WebLLMProvider(MODELS[0]),
    ])
      responses.push(
        await provider.respond(
          lang === "bg"
            ? "Колко земеделски субсидии са изплатени за 2025?"
            : "How much in farm subsidies was paid for financial year 2025?",
          { lang, election: "1990" },
        ),
      );
    for (const r of responses) {
      expect(r.env?.funding?.query.financialYears).toEqual(["2025"]);
      expect(r.env?.funding?.query).toEqual(responses[0].env?.funding?.query);
      expect(r.meta?.narratedBy).toBe("rules");
      expect(r.text).toContain("100");
    }
    expect(external).not.toHaveBeenCalled();
  },
);
