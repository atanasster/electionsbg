import { afterEach, expect, it } from "vitest";
import { HeuristicProvider } from "../llm/provider";
import { clearDataCache, setDbFetcher, setFetcher } from "../tools/dataClient";
import { dispatchPrompt } from "./dispatchPrompt";
import { toChatQuestionIntent } from "./questionAdapter";
import { route } from "../orchestrator/router";
import { followUps } from "./followups";
afterEach(clearDataCache);
it.each(["bg", "en"] as const)(
  "price increase means largest rise, not cheapest basket (%s)",
  async (lang) => {
    setDbFetcher(async () => ({
      places: [
        {
          tier: "settlement",
          name: "Cheap",
          code: "1",
          basketLevel: 10,
          indexSinceEuro: 105,
          rank: { national: 1 },
          rankChange: { national: 2 },
        },
        {
          tier: "settlement",
          name: "Rising",
          code: "2",
          basketLevel: 20,
          indexSinceEuro: 150,
          rank: { national: 2 },
          rankChange: { national: 1 },
        },
      ],
    }));
    const provider = new HeuristicProvider();
    const response = await provider.respond(
      lang === "bg"
        ? "Къде е най-голямото поскъпване на цените?"
        : "Where did prices rise the most?",
      { lang, election: "2026_04_19" },
    );
    expect(response.env?.rows?.[0].place).toBe("Rising");
    expect(
      response.env?.columns?.find((c) => c.key === "value")?.label,
    ).toMatch(/Поскъпване|Rise/);
  },
);
it.each(["bg", "en"] as const)(
  "budget card executes plan/actual and continues with budget data (%s)",
  async (lang) => {
    setFetcher(async (path) => {
      if (path.includes("budget"))
        return {
          fiscalYears: [
            {
              fiscalYear: 2025,
              complete: true,
              asOf: "2025-12-31",
              planned: {
                expenditure: { amount: 100, amountEur: 100, currency: "EUR" },
              },
              actual: {
                balance: { amount: -10, amountEur: -10, currency: "EUR" },
                expenditure: { amount: 90, amountEur: 90, currency: "EUR" },
              },
            },
          ],
        };
      throw new Error(`Unexpected source ${path}`);
    });
    const provider = new HeuristicProvider();
    const intent = toChatQuestionIntent("budgetOverview", lang);
    const response = await dispatchPrompt(
      provider,
      intent.text,
      { lang, election: "2026_04_19" },
      undefined,
      undefined,
      intent,
    );
    expect(response.env).not.toBeNull();
    expect(response.env?.title).toContain("2025");
    expect(response.env?.columns?.map((c) => c.key)).toEqual(
      expect.arrayContaining(["planned", "value"]),
    );
    const next = followUps(response.env!, response.args);
    expect(next.length).toBeGreaterThan(0);
    for (const suggestion of next)
      expect(
        toChatQuestionIntent(suggestion.questionId, lang, suggestion.parameters)
          .tool,
      ).toMatch(/budget/);
  },
);

it.each([
  "Покажи показателя „Коефициент на икономическа активност“.",
  "Show the indicator “House prices”.",
  "Show the indicator “Municipal commitments”.",
  "Show the indicator “Employment rate”.",
])("requests clarification instead of changing the subject for %s", (text) => {
  expect(route(text, { lang: "en", election: "2026_04_19" })).toBeNull();
});
