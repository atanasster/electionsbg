// Component guard for the portfolio composition (audit T3.6).
//
// The controls that matter: DEBT must never enter the stack (it is a liability, and
// stacking it with holdings makes the bands sum to something that is not the portfolio),
// and a category the person does not declare must not occupy a band or a legend slot.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WealthPoint } from "./usePersonWealth";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 640, height: 200 }}>{children}</div>
    ),
  };
});

import { PersonPortfolioComposition } from "./PersonPortfolioComposition";
import { COMPOSITION_CATEGORIES } from "./compositionCategories";

// The eight asset categories 089's CHECK constrains declaration_asset.category to,
// transcribed here as the sibling schema test transcribes them. The stack must be exactly
// these minus `debt` — anything else and a real holding contributes to the assets line
// above but to no band here, silently, with nothing failing.
const ASSET_CATEGORIES = [
  "real_estate",
  "vehicle",
  "cash",
  "bank",
  "receivable",
  "debt",
  "investment",
  "security",
];

const pt = (year: number, byCategory: Record<string, number>): WealthPoint => ({
  year,
  assetsEur: 0,
  debtsEur: 0,
  netEur: 0,
  incomeEur: 0,
  filings: 1,
  tier: "exec",
  byCategory,
});

describe("PersonPortfolioComposition", () => {
  it("stacks exactly the asset categories minus debt", () => {
    expect([...COMPOSITION_CATEGORIES.map((c) => c.key)].sort()).toEqual(
      ASSET_CATEGORIES.filter((c) => c !== "debt").sort(),
    );
  });

  // A category that is zero in SOME years but not others must keep its band — dropping it
  // would erase a holding the person actually declared.
  it("keeps a category that is zero in some years but not others", () => {
    render(
      <PersonPortfolioComposition
        series={[
          pt(2023, { real_estate: 100000, vehicle: 0 }),
          pt(2024, { real_estate: 100000, vehicle: 25000 }),
        ]}
      />,
    );
    expect(screen.getByText("asset_category_vehicle")).toBeInTheDocument();
  });

  // A liability in a stack of holdings would make the bands sum to a number that is not
  // the portfolio.
  it("never stacks debt", () => {
    render(
      <PersonPortfolioComposition
        series={[
          pt(2023, { real_estate: 100000, debt: 50000 }),
          pt(2024, { real_estate: 120000, debt: 40000 }),
        ]}
      />,
    );
    expect(screen.getByText("asset_category_real_estate")).toBeInTheDocument();
    expect(screen.queryByText("asset_category_debt")).not.toBeInTheDocument();
  });

  // An all-zero category is legend noise and an invisible band.
  it("omits categories the person does not declare", () => {
    render(
      <PersonPortfolioComposition
        series={[
          pt(2023, { real_estate: 100000, vehicle: 0 }),
          pt(2024, { real_estate: 120000, vehicle: 0 }),
        ]}
      />,
    );
    expect(screen.getByText("asset_category_real_estate")).toBeInTheDocument();
    expect(
      screen.queryByText("asset_category_vehicle"),
    ).not.toBeInTheDocument();
  });

  it("self-hides below two points", () => {
    const { container } = render(
      <PersonPortfolioComposition series={[pt(2024, { real_estate: 1000 })]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("self-hides when only debt is declared", () => {
    const { container } = render(
      <PersonPortfolioComposition
        series={[pt(2023, { debt: 5000 }), pt(2024, { debt: 4000 })]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
