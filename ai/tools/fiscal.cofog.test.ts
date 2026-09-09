import { beforeEach, expect, it, vi } from "vitest";
import source from "../../data/cofog.json";
import { budgetByFunction, budgetOverview, budgetFunction } from "./fiscal";
import { fetchData } from "./dataClient";
import type { ToolContext } from "./types";
vi.mock("./dataClient", async (load) => ({
  ...(await load<object>()),
  fetchData: vi.fn(),
}));
const ctx = { lang: "en" } as ToolContext;
beforeEach(() => vi.mocked(fetchData).mockResolvedValue(source));
it("uses the official total once and never plots TOTAL as a function", async () => {
  const r = await budgetByFunction({ year: 2024 }, ctx);
  expect(r.rows).toHaveLength(10);
  expect(r.facts.total).toBe("€41.1bn");
  expect(r.rows?.[0].pct).toBe(36.76);
  expect(r.series?.[0].points.reduce((s, p) => s + Number(p.y), 0)).toBe(
    41059400000,
  );
});
it("does not substitute another year or invent a percentage without a total", async () => {
  vi.mocked(fetchData).mockResolvedValue({
    latestYear: 2024,
    series: {
      TOTAL: [{ year: 2024, valueEur: 100 }],
      GF01: [{ year: 2023, valueEur: 20 }],
      GF02: [{ year: 2024, valueEur: 0 }],
    },
  });
  const r = await budgetByFunction({ year: 2024 }, ctx);
  expect(r.rows).toHaveLength(1);
  expect(r.facts.missing_functions).toBe(1);
  expect(r.rows?.[0].pct).toBe(0);
  vi.mocked(fetchData).mockResolvedValue({
    latestYear: 2024,
    series: { GF02: [{ year: 2024, valueEur: 20 }] },
  });
  const noTotal = await budgetByFunction({ year: 2024 }, ctx);
  expect(noTotal.rows?.[0].pct).toBe("—");
  expect(noTotal.facts.total).toBe("—");
});

it("keeps a requested component year even when the total is only published for another year", async () => {
  vi.mocked(fetchData).mockResolvedValue({
    latestYear: 2024,
    series: {
      TOTAL: [{ year: 2023, valueEur: 100 }],
      GF01: [{ year: 2024, valueEur: 25 }],
    },
  });
  const r = await budgetByFunction({ year: 2024 }, ctx);
  expect(r.facts.year).toBe(2024);
  expect(r.rows?.[0].pct).toBe("—");
  expect(r.facts.total).toBe("—");
});
it("uses component years when TOTAL is empty", async () => {
  vi.mocked(fetchData).mockResolvedValue({
    latestYear: 2025,
    series: { TOTAL: [], GF01: [{ year: 2024, valueEur: 25 }] },
  });
  const r = await budgetByFunction({ year: 2024 }, ctx);
  expect(r.facts.year).toBe(2024);
  expect(r.rows).toHaveLength(1);
  expect(r.rows?.[0].pct).toBe("—");
});

it("defaults to latest available budget and separates annual plan from actuals", async () => {
  const money = (amountEur: number) => ({
    amountEur,
    amount: amountEur,
    currency: "EUR",
  });
  vi.mocked(fetchData).mockResolvedValue({
    fiscalYears: [
      { fiscalYear: 2026, complete: false, actual: { balance: money(1) } },
      {
        fiscalYear: 2025,
        complete: true,
        asOf: "2025-12-31",
        planned: { expenditure: money(200) },
        actual: { expenditure: money(150), balance: money(-10) },
      },
      { fiscalYear: 2024, complete: true, actual: { balance: money(1) } },
    ],
  });
  const latest = await budgetOverview({}, ctx);
  expect(latest.facts.year).toBe(2026);
  expect(latest.subtitle).toContain("Partial year");
  const r = await budgetOverview({ year: 2025 }, ctx);
  expect(r.facts.year).toBe(2025);
  expect(r.rows?.[1]).toMatchObject({ planned: "€200", value: "€150" });
  expect(r.rows?.[0].value).toBe("—");
  expect(r.facts.revenue).toBe("—");
  expect(r.subtitle).toContain("2025-12-31");
  expect(r.subtitle).toContain("State-budget cash");
  const partial = await budgetOverview({ year: 2026 }, ctx);
  expect(partial.facts.year).toBe(2026);
  expect(partial.subtitle).toContain("Partial year");
});
it("labels latest COFOG coverage and selects latest regardless of source ordering", async () => {
  vi.mocked(fetchData).mockResolvedValue({
    latestYear: 2024,
    series: {
      TOTAL: [
        { year: 2024, valueEur: 100 },
        { year: 2023, valueEur: 90 },
      ],
      GF01: [
        { year: 2024, valueEur: 100 },
        { year: 2023, valueEur: 90 },
      ],
    },
  });
  const r = await budgetByFunction({}, ctx);
  expect(r.facts.year).toBe(2024);
  expect(r.subtitle).toContain("Latest available COFOG data: 2024");
  expect(r.subtitle).toContain("not the current budget plan");
});

it("never combines different years in a single COFOG function share or rank", async () => {
  vi.mocked(fetchData).mockResolvedValue({
    latestYear: 2024,
    series: {
      TOTAL: [{ year: 2023, valueEur: 100 }],
      GF01: [{ year: 2024, valueEur: 25 }],
      GF02: [{ year: 2023, valueEur: 50 }],
    },
  });
  const r = await budgetFunction({ category: "GF01", year: 2024 }, ctx);
  expect(r.facts.year).toBe(2024);
  expect(r.facts.total).toBe("—");
  expect(r.facts.share_of_budget).toBe("—");
  expect(r.facts.rank).toBe("—");
});
