// Render-level gates for the tile's four rules.
//
// The rules are stated in the file's header and encoded in translation keys —
// which is exactly how one of them came to be unreachable: `suppressed_fields`
// stores the ingest's JSON field names ("commitments") while the tile compared
// them against SQL column names ("commitments_eur"), so „not published for this
// period" could never render and every frozen column fell through to „no data".
// Nothing but a render-level test can see that.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MunicipalFiscalPayload } from "@/data/budget/useMunicipalFiscal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o ? `${k}:${JSON.stringify(o)}` : k,
    i18n: { language: "bg" },
  }),
}));

const mockFiscal = vi.fn();
vi.mock("@/data/budget/useMunicipalFiscal", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useMunicipalFiscal: (o?: string) => mockFiscal(o),
}));

import { MyAreaMunicipalFiscalTile } from "./MyAreaMunicipalFiscalTile";

const payload = (
  over: Partial<MunicipalFiscalPayload> = {},
): MunicipalFiscalPayload =>
  ({
    obshtina: "SLV11",
    mf_code: 5101,
    fiscal_year: 2024,
    quarter: 4,
    name_bg: "Котел",
    name_en: "Kotel",
    oblast_code: "SLV",
    currency: "BGN",
    commitments_eur: 5_800_000,
    expense_obligations_eur: 443_156,
    arrears_eur: 9_352,
    revenue_eur: null,
    expenditure_eur: null,
    budget_balance_eur: null,
    cash_on_hand_eur: null,
    debt_stock_eur: null,
    expenditure_avg4y_eur: null,
    arrears_pct: 0.1,
    obligations_pct: 5,
    commitments_pct: 60,
    arrears_basis: "actual",
    obligations_basis: "avg4y",
    commitments_basis: "avg4y",
    collection_dni_pct: null,
    collection_dprs_pct: null,
    collection_avg_pct: null,
    criteria_met: [3],
    criteria_evaluable: [2, 3, 4],
    meets_threshold: false,
    in_recovery_procedure: false,
    suppressed_fields: null,
    population: 15_919,
    commitments_per_capita_eur: 365,
    per_capita_rank: 227,
    per_capita_ranked_count: 265,
    per_capita_median_eur: 681,
    series: null,
    ...over,
  }) as MunicipalFiscalPayload;

const renderTile = (
  data: MunicipalFiscalPayload | null,
  obshtina = "SLV11",
) => {
  mockFiscal.mockReturnValue({ data, isPending: false });
  return render(
    <MemoryRouter>
      <MyAreaMunicipalFiscalTile obshtina={obshtina} />
    </MemoryRouter>,
  );
};

describe("MyAreaMunicipalFiscalTile", () => {
  it("renders nothing when the município has no return", () => {
    const { container } = renderTile(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("says WITHHELD, not no-data, for a column the source froze", () => {
    // Rule 2, and the one that was unreachable: `suppressed_fields` carries the
    // ingest's JSON names, not the SQL column names.
    renderTile(
      payload({ commitments_eur: null, suppressed_fields: ["commitments"] }),
    );
    expect(screen.getByText("mf_tile_withheld")).toBeVisible();
    expect(screen.queryByText("mf_tile_not_published")).toBeNull();
  });

  it("says no-data for a stock that was never published at all", () => {
    // The other side of the same distinction: absent from the row AND absent
    // from suppressed_fields is „never published", not „frozen".
    renderTile(payload({ arrears_eur: null, suppressed_fields: null }));
    expect(screen.getByText("mf_tile_not_published")).toBeVisible();
    expect(screen.queryByText("mf_tile_withheld")).toBeNull();
  });

  it("never prints €0 for a missing stock", () => {
    const { container } = renderTile(
      payload({ commitments_eur: null, suppressed_fields: ["commitments"] }),
    );
    expect(container.textContent).not.toMatch(/€\s*0(\D|$)/);
  });

  it("draws no bar for a missing stock", () => {
    const { container } = renderTile(
      payload({ arrears_eur: null, expense_obligations_eur: null }),
    );
    // One track per stock, but only the stock with a value gets a fill.
    const fills = container.querySelectorAll('div[style*="background-color"]');
    expect(fills).toHaveLength(1);
  });

  it("renders no чл. 130а verdict off Q4", () => {
    // The criteria are annual by construction; a mid-year verdict would be a
    // fabrication, and it is exactly the figure that gets quoted.
    renderTile(payload({ quarter: 2 }));
    expect(screen.queryByText(/mf_tile_criteria/)).toBeNull();
  });

  it("renders the verdict on Q4, with its evaluable denominator", () => {
    renderTile(
      payload({ quarter: 4, criteria_met: [3], criteria_evaluable: [2, 3, 4] }),
    );
    expect(screen.getByText(/mf_tile_criteria:/)).toHaveTextContent('"met":1');
    expect(screen.getByText(/mf_tile_criteria_note:/)).toHaveTextContent(
      '"evaluable":3',
    );
  });

  it("states a recovery procedure separately from our own verdict", () => {
    // Rule 3: `in_recovery_procedure` is the ministry's administrative fact,
    // `meets_threshold` is our derivation. They never merge into one badge.
    renderTile(
      payload({ in_recovery_procedure: true, meets_threshold: false }),
    );
    expect(screen.getByText("mf_tile_in_recovery")).toBeVisible();
  });

  it("resolves a Sofia district to the city-wide return, and says so", () => {
    renderTile(payload({ obshtina: "SOF00" }), "S2201");
    expect(mockFiscal).toHaveBeenLastCalledWith("SOF00");
    expect(screen.getByText("mf_tile_city_wide")).toBeVisible();
  });

  it("does NOT claim city-wide figures on an ordinary município", () => {
    renderTile(payload(), "SLV11");
    expect(mockFiscal).toHaveBeenLastCalledWith("SLV11");
    expect(screen.queryByText("mf_tile_city_wide")).toBeNull();
  });

  it("names the period in the rank, because the browse ranks a different one", () => {
    renderTile(payload({ fiscal_year: 2025, quarter: 2 }));
    expect(screen.getByText(/mf_tile_rank:/)).toHaveTextContent('"2025 Q2"');
  });

  it("suppresses the headline when no commitments were published", () => {
    renderTile(payload({ commitments_per_capita_eur: null }));
    expect(screen.getByText("mf_tile_no_per_capita")).toBeVisible();
    expect(screen.queryByText(/mf_tile_rank/)).toBeNull();
  });
});
