import { beforeEach, expect, it, vi } from "vitest";
import source from "../../data/cofog.json";
import { budgetByFunction } from "./fiscal";
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
