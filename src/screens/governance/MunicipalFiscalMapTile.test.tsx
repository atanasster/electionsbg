// Render-level gates for the map's two absolute rules.
//
// Both were stated in the file header and neither was enforced: the Sofia
// disclosure was keyed on a `sofiaFallback` that `useSofiaMergedNationMap`
// makes unreachable (it merges the 24 районни features into one SOF00 polygon
// before the component sees them), and the criteria layer turned „nothing
// evaluable" into a 0 that paints the healthiest colour in the country. A
// comment cannot hold either rule; this can.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MunicipalFiscalRankingRow } from "@/data/budget/useMunicipalFiscalRanking";
import { fillFor } from "./municipalFiscalLayers";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o ? `${k}:${JSON.stringify(o)}` : k,
    i18n: { language: "bg" },
  }),
}));

// The geometry: two ordinary municipalities plus Sofia's merged polygon, which
// is what the real hook hands over.
const FEATURES = [
  { properties: { nuts4: "BLG18" } },
  { properties: { nuts4: "VAR05" } },
  { properties: { nuts4: "SOF00" } },
];
vi.mock("@/data/municipalities/useSofiaMergedNationMap", () => ({
  useSofiaMergedNationMap: () => ({ features: FEATURES }),
}));
vi.mock("@/data/municipalities/useMunicipalities", () => ({
  useMunicipalities: () => ({ findMunicipality: () => null }),
}));
vi.mock("@/ux/useNavigateParams", () => ({
  useNavigateParams: () => () => {},
}));
vi.mock("@/screens/components/maps/d3_utils", () => ({
  getDataProjection: () => ({ path: () => "M0,0", bounds: [], scale: 1 }),
}));
vi.mock("@/screens/components/maps/LeafletMap", () => ({
  LeafletMap: () => null,
}));
vi.mock("@/screens/components/maps/SVGMapContainer", () => ({
  SVGMapContainer: ({ children }: { children?: React.ReactNode }) => (
    <svg>{children}</svg>
  ),
}));
// Each feature reports its fill and exposes its hover handler, which is how the
// tooltip assertions reach the content without a real pointer.
vi.mock("@/screens/components/maps/FeatureMap", () => ({
  FeatureMap: ({
    feature,
    fillColor,
    onMouseEnter,
  }: {
    feature: { properties: { nuts4: string } };
    fillColor: string;
    onMouseEnter: (e: { pageX: number; pageY: number }) => void;
  }) => (
    <path
      data-testid={`f-${feature.properties.nuts4}`}
      fill={fillColor}
      onMouseEnter={() => onMouseEnter({ pageX: 0, pageY: 0 })}
    />
  ),
}));
vi.mock("@/layout/dataview/MapLayout", () => ({
  MapLayout: ({
    children,
  }: {
    children: (size: [number, number]) => React.ReactNode;
  }) => <div>{children([800, 500])}</div>,
}));

import { MunicipalFiscalMapTile } from "./MunicipalFiscalMapTile";

const row = (
  obshtina: string,
  over: Partial<MunicipalFiscalRankingRow> = {},
): MunicipalFiscalRankingRow =>
  ({
    obshtina,
    name_bg: obshtina,
    name_en: null,
    oblast_code: null,
    fiscal_year: 2024,
    quarter: 4,
    commitments_eur: 1_000_000,
    commitments_pct: 40,
    expense_obligations_eur: 1,
    obligations_pct: 1,
    arrears_eur: 1,
    arrears_pct: 1,
    cash_on_hand_eur: 1,
    debt_stock_eur: 1,
    meets_threshold: false,
    in_recovery_procedure: false,
    criteria_met: [],
    criteria_evaluable: [2, 3, 4],
    population: 1000,
    commitments_per_capita_eur: 1000,
    collection_avg_pct: 76,
    suppressed_fields: null,
    ...over,
  }) as MunicipalFiscalRankingRow;

const renderMap = (
  rows: MunicipalFiscalRankingRow[],
  layerId = "commitmentsPct",
) =>
  render(
    <MemoryRouter>
      <MunicipalFiscalMapTile
        rows={rows}
        layerId={layerId as never}
        onLayerChange={() => {}}
        year={2024}
      />
    </MemoryRouter>,
  );

const fillOf = (code: string) =>
  screen.getByTestId(`f-${code}`).getAttribute("fill");

describe("MunicipalFiscalMapTile", () => {
  it("renders nothing with no rows", () => {
    const { container } = renderMap([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("paints a município with no row the NO-DATA fill, never a value colour", () => {
    // The single worst thing this map could do is colour a non-filer 0 — the
    // healthiest shade in the country.
    renderMap([row("BLG18"), row("SOF00")]);
    expect(fillOf("VAR05")).toBe(fillFor(null));
    expect(fillOf("BLG18")).not.toBe(fillFor(null));
  });

  it("counts the no-data municipalities in the legend", () => {
    renderMap([row("BLG18"), row("SOF00")]);
    expect(screen.getByText(/mf_map_legend_no_data:/)).toHaveTextContent(
      '"count":1',
    );
  });

  it("SAYS Sofia's figure is city-wide", () => {
    // The rule that could never fire: keyed on a fallback the merged geometry
    // makes unreachable. Keyed on the code, it shows under either geometry.
    renderMap([row("BLG18"), row("SOF00")]);
    fireEvent.mouseOver(screen.getByTestId("f-SOF00"));
    expect(screen.getByText("mf_map_tooltip_sofia")).toBeVisible();
  });

  it("does NOT claim city-wide on an ordinary município", () => {
    renderMap([row("BLG18"), row("SOF00")]);
    fireEvent.mouseOver(screen.getByTestId("f-BLG18"));
    expect(screen.queryByText("mf_map_tooltip_sofia")).toBeNull();
  });

  it("paints a município with NOTHING EVALUABLE as no-data on the criteria layer", () => {
    // The other critical: `0 met` is the palest teal, so an unknown rendered as
    // 0 is a município we know nothing about painted as the healthiest.
    renderMap(
      [
        row("BLG18", { criteria_evaluable: [], criteria_met: [] }),
        row("VAR05", { criteria_evaluable: [2, 3, 4], criteria_met: [] }),
        row("SOF00"),
      ],
      "criteria",
    );
    expect(fillOf("BLG18")).toBe(fillFor(null));
    expect(fillOf("VAR05")).not.toBe(fillFor(null));
  });

  it("speaks the page vocabulary on the binary layer, not a bare 1", () => {
    renderMap(
      [row("BLG18", { in_recovery_procedure: true }), row("SOF00")],
      "recovery",
    );
    fireEvent.mouseOver(screen.getByTestId("f-BLG18"));
    expect(screen.getByText("mf_recovery_yes")).toBeVisible();
  });

  it("keeps the of-seven denominator in the criteria tooltip", () => {
    renderMap(
      [row("BLG18", { criteria_met: [3, 4] }), row("SOF00")],
      "criteria",
    );
    fireEvent.mouseOver(screen.getByTestId("f-BLG18"));
    expect(screen.getByText(/mf_criteria_of_six:/)).toHaveTextContent(
      '"met":2',
    );
  });

  it("calls the collection layer's centre an AVERAGE, not a threshold", () => {
    // чл. 130а т. 6's real test is against the tax-base-weighted national rate,
    // which this repo declares unavailable. Labelling our own cohort mean
    // „праг" would lend the statute's authority to a proxy.
    renderMap([row("BLG18"), row("VAR05"), row("SOF00")], "collection");
    expect(screen.getByText(/mf_map_legend_cohort_mean/)).toBeVisible();
    expect(screen.queryByText(/mf_map_legend_break/)).toBeNull();
  });

  it("calls the threshold layers' break a THRESHOLD", () => {
    renderMap([row("BLG18"), row("SOF00")], "commitmentsPct");
    expect(screen.getByText(/mf_map_legend_break:/)).toHaveTextContent("50");
  });

  it("says it draws one year at a time, and that the mean is still missing", () => {
    // The corpus has nine year-ends since the backfill, so „one year" stopped
    // being a limit and became a choice — but averaging them is still not
    // possible, and that is the part the caption must keep saying.
    renderMap([row("BLG18"), row("SOF00")]);
    expect(screen.getByText("mf_map_one_year_at_a_time")).toBeVisible();
  });

  it("carries the per-resident caveat on the layer that needs it", () => {
    renderMap([row("BLG18"), row("SOF00")], "perCapita");
    expect(screen.getByText("mf_map_caveat_per_capita")).toBeVisible();
  });
});
