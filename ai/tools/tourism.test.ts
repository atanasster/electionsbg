import { afterEach, expect, it } from "vitest";
import { clearDataCache, setFetcher } from "./dataClient";
import { tourismSeasonality, tourismSourceMarkets } from "./tourism";
const ctx = { lang: "en" as const, election: "2026_04_19" };
afterEach(clearDataCache);
const source = {
  seasonalityYear: 2025,
  peakMonth: 8,
  summerShareForeign: 0.75,
  winterShareForeign: 0.1,
  seasonality: [{ month: 8, foreign: 750, domestic: 50 }],
  annualForeign: [{ year: 2025, nights: 1000 }],
  sourceMarketsYear: 2025,
  sourceMarketsForeignTotal: 1000,
  sourceMarkets: [{ code: "DE", name: "Germany", nights: 250 }],
};
it("converts fractions to percentages using the source denominator", async () => {
  setFetcher(async () => source);
  const season = await tourismSeasonality({}, ctx),
    markets = await tourismSourceMarkets({}, ctx);
  expect(season.facts?.summerShareForeign).toBe("75%");
  expect(season.facts?.winterShareForeign).toBe("10%");
  expect(markets.facts?.topShare).toBe("25%");
  expect(markets.rows?.[0].share).toBe("25%");
});
it("does not invent a market denominator", async () => {
  setFetcher(async () => ({ ...source, sourceMarketsForeignTotal: 0 }));
  expect((await tourismSourceMarkets({}, ctx)).facts?.topShare).toBe("—");
});
