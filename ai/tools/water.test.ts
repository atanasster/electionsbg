import { afterEach, expect, it } from "vitest";
import { clearDataCache, setFetcher } from "./dataClient";
import { WATER_TOOL } from "./water";
import { resolveMacroKey } from "./macro";
import labels from "./macroLabels.json";
import { route } from "../orchestrator/router";
afterEach(clearDataCache);
it("preserves missing water observations and national-only scope", async () => {
  setFetcher(async () => ({
    source: "NSI",
    sourceUrl: "https://www.nsi.bg",
    years: [
      {
        year: 2024,
        connectedWaterPct: 99.4,
        wasteTreatmentPct: null,
        rationingPct: 6.2,
      },
    ],
  }));
  const env = await WATER_TOOL.run({}, { lang: "bg", election: "2026_04_19" });
  expect(env.rows?.[0]).toEqual({
    year: 2024,
    connectedWaterPct: 99.4,
    wasteTreatmentPct: null,
    rationingPct: 6.2,
  });
  expect(env.subtitle).toContain("Национални годишни");
  expect(env.facts?.latestYear).toBe(2024);
});
it.each(Object.entries(labels))(
  "recognizes the source measure %s in both languages",
  (key, label) => {
    expect(resolveMacroKey(key)).toBe(key);
    expect(resolveMacroKey(label.bg)).toBe(key);
    expect(resolveMacroKey(label.en)).toBe(key);
    expect(
      route(`Покажи показателя „${label.bg}“.`, {
        lang: "bg",
        election: "2026_04_19",
      }),
    ).toEqual({ tool: "macroIndicator", args: { indicator: key } });
  },
);
it("keeps the denominator and subject of similar macro measures", () => {
  expect(resolveMacroKey("trust in parliament")).not.toBe("housePricesYoY");
  expect(resolveMacroKey(labels.govDebtNominal.bg)).toBe("govDebtNominal");
  expect(resolveMacroKey(labels.unemploymentMonthly.bg)).toBe(
    "unemploymentMonthly",
  );
});
it("answers the requested macro period through the normal provider", async () => {
  const { HeuristicProvider } = await import("../llm/provider");
  setFetcher(async () => ({
    indicators: {
      unemployment: {
        titleBg: "Безработица",
        titleEn: "Unemployment rate",
        unitLabelBg: "%",
      },
    },
    series: {
      unemployment: [
        { year: 2020, period: "2020-Q4", value: 5.2 },
        { year: 2025, period: "2025-Q4", value: 3.1 },
      ],
    },
  }));
  const response = await new HeuristicProvider().respond(
    "Покажи показателя Безработица за 2020 г.",
    { lang: "bg", election: "2026_04_19" },
  );
  expect(response.env?.facts).toMatchObject({
    latest_period: "2020-Q4",
    latest_value: 5.2,
  });
});
