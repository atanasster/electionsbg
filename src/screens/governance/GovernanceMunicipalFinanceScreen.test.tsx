// Render-level gates for the browse's three EMPTY states and its two
// language-sensitive readings.
//
// The states matter because collapsing them was the same „absent is not empty"
// conflation the rest of this module exists to prevent, turned on the page's
// own state: a 500 and a legal-but-uncovered `?year` both told the reader our
// ingest was broken. `?year=2025` is reachable today — the corpus's only
// year-end is 2024.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MunicipalFiscalRankingRow } from "@/data/budget/useMunicipalFiscalRanking";

const language = { current: "bg" };
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o ? `${k}:${JSON.stringify(o)}` : k,
    i18n: {
      get language() {
        return language.current;
      },
    },
  }),
}));
vi.mock("@/ux/Title", () => ({ Title: () => null }));
// The map drags in Leaflet + d3-geo + the nation geometry, none of which jsdom
// can render and none of which these assertions are about. It has its own
// tests; here it only needs to not exist.
vi.mock("./MunicipalFiscalMapTile", () => ({
  MunicipalFiscalMapTile: () => <div data-testid="map" />,
}));

const mockRanking = vi.fn();
const mockYears = vi.fn(() => [] as number[]);
vi.mock("@/data/budget/useMunicipalFiscalRanking", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useMunicipalFiscalRanking: () => mockRanking(),
  // Stubbed too: it is a second useQuery, and unmocked it needs a
  // QueryClientProvider these assertions have no other use for.
  useMunicipalFiscalYears: () => mockYears(),
}));

import { GovernanceMunicipalFinanceScreen } from "./GovernanceMunicipalFinanceScreen";

const row = (
  over: Partial<MunicipalFiscalRankingRow> = {},
): MunicipalFiscalRankingRow =>
  ({
    obshtina: "BLG18",
    name_bg: "Кресна",
    name_en: "Kresna",
    oblast_code: "BLG",
    fiscal_year: 2024,
    quarter: 4,
    commitments_eur: 17_273_854,
    commitments_pct: 229.3,
    expense_obligations_eur: 1_100_000,
    obligations_pct: 14,
    arrears_eur: 195_709,
    arrears_pct: 1.7,
    cash_on_hand_eur: 2_000_000,
    debt_stock_eur: 1_700_000,
    meets_threshold: false,
    in_recovery_procedure: false,
    criteria_met: [3],
    criteria_evaluable: [2, 3, 4],
    population: 4_546,
    commitments_per_capita_eur: 3_800,
    collection_avg_pct: 76,
    suppressed_fields: null,
    ...over,
  }) as MunicipalFiscalRankingRow;

const renderAt = (
  search: string,
  state: {
    rows?: MunicipalFiscalRankingRow[];
    isPending?: boolean;
    isError?: boolean;
  },
) => {
  mockRanking.mockReturnValue({
    rows: state.rows ?? [],
    isPending: state.isPending ?? false,
    isError: state.isError ?? false,
  });
  return render(
    <MemoryRouter initialEntries={[`/governance/municipal-finance${search}`]}>
      <GovernanceMunicipalFinanceScreen />
    </MemoryRouter>,
  );
};

describe("GovernanceMunicipalFinanceScreen — the three empty states", () => {
  it("says the FETCH failed when it failed", () => {
    renderAt("", { isError: true });
    expect(screen.getByText("mf_browse_error")).toBeVisible();
    expect(screen.queryByText("mf_browse_empty")).toBeNull();
  });

  it("names the YEAR when a legal year has no year-end rows", () => {
    // Not „the load step has not run": the ingest is fine, the corpus simply
    // does not cover 2025 yet.
    renderAt("?year=2025", {});
    expect(screen.getByText(/mf_browse_no_year:/)).toHaveTextContent(
      '"year":2025',
    );
    expect(screen.queryByText("mf_browse_empty")).toBeNull();
    expect(screen.queryByText("mf_browse_error")).toBeNull();
  });

  it("keeps the corpus-absent wording for a genuinely empty corpus", () => {
    renderAt("", {});
    expect(screen.getByText("mf_browse_empty")).toBeVisible();
  });

  it("says none of the three while loading", () => {
    renderAt("", { isPending: true });
    for (const k of ["mf_browse_error", "mf_browse_empty"]) {
      expect(screen.queryByText(k)).toBeNull();
    }
    expect(screen.getByText("loading")).toBeVisible();
  });
});

describe("GovernanceMunicipalFinanceScreen — rendering", () => {
  it("renders the Bulgarian name under bg", () => {
    language.current = "bg";
    renderAt("", { rows: [row()] });
    expect(screen.getByText("Кресна")).toBeVisible();
  });

  it("renders the English name under en", () => {
    language.current = "en";
    renderAt("", { rows: [row()] });
    expect(screen.getByText("Kresna")).toBeVisible();
    expect(screen.queryByText("Кресна")).toBeNull();
    language.current = "bg";
  });

  it("falls back to the Bulgarian name when the dictionary has no English one", () => {
    language.current = "en";
    renderAt("", { rows: [row({ name_en: null })] });
    expect(screen.getByText("Кресна")).toBeVisible();
    language.current = "bg";
  });

  it("prints a dash, never €0, for a withheld figure", () => {
    const { container } = renderAt("", {
      rows: [row({ arrears_eur: null, suppressed_fields: ["arrears"] })],
    });
    expect(container.textContent).not.toMatch(/€\s*0(\D|$)/);
    expect(container.textContent).toContain("—");
  });

  it("marks the sorted column for a screen reader", () => {
    renderAt("?sort=arrears", { rows: [row()] });
    const sorted = document.querySelectorAll('th[aria-sort="descending"]');
    expect(sorted).toHaveLength(1);
  });
});

describe("GovernanceMunicipalFinanceScreen — the year picker", () => {
  it("is hidden when the corpus covers a single year-end", () => {
    // A control that cannot change anything is worse than no control.
    mockYears.mockReturnValue([2024]);
    renderAt("", { rows: [row()] });
    expect(screen.queryByLabelText("mf_browse_year")).toBeNull();
    mockYears.mockReturnValue([]);
  });

  it("offers every year-end the corpus covers, newest first", () => {
    mockYears.mockReturnValue([2024, 2023, 2022]);
    renderAt("", { rows: [row()] });
    expect(screen.getByLabelText("mf_browse_year")).toBeVisible();
    mockYears.mockReturnValue([]);
  });
});
