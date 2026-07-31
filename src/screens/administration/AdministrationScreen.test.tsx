// The scope wiring on /sector/administration, which has the nastiest version of
// the shared-`?pscope` bug: the Доклад за състоянието на администрацията lags the
// calendar by a year or two, while the procurement picker that mints the param
// runs to the current year. An unresolved year used to reach `selYear` — so every
// KPI hint read "…, 2026" over the LATEST REPORT's numbers, with the picker
// showing nothing at all. Nothing errored; it just answered the wrong question.
//
// The invariant, same as /culture's: the year the page counted and the year the
// control shows are one value.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactNode } from "react";
import type {
  AdminContext,
  AdminNationalYear,
} from "@/data/administration/useAdminContext";

// The report covers 2023–2024; 2025 and 2026 exist for procurement but not here.
const LATEST = 2024;
const POSITIONS = { 2023: 143_502, 2024: 145_623 };

const year = (total: number): AdminNationalYear => ({
  positions: {
    total,
    central: total - 40_000,
    territorial: 40_000,
    municipal: null,
    filled: total - 12_000,
    vacant: 12_000,
    vacantOverSixMonths: 3_000,
  },
  structureCounts: {
    central: { Министерство: 20 },
    territorial: { Област: 28 },
  },
});

const ctx: AdminContext = {
  generatedAt: "2026-07-30",
  cofogLatestYear: LATEST,
  national: { "2023": year(POSITIONS[2023]), "2024": year(POSITIONS[2024]) },
  costByYear: { "2024": [{ adminId: "mfa", eur: 1_000_000 }] },
  population: [
    { year: 2023, value: 6_500_000 },
    { year: 2024, value: 6_450_000 },
  ],
  gf01: {
    series: [
      { year: 2023, valueEur: 2e9, pctGdp: 2.1, perCapita: 300 },
      { year: LATEST, valueEur: 2.1e9, pctGdp: 2.2, perCapita: 320 },
    ],
    euCompare: { year: LATEST, band: null, bars: [] },
  },
};

vi.mock("@/data/administration/useAdminContext", () => ({
  useAdminContext: () => ({ data: ctx }),
}));
vi.mock("@/data/administration/useAdminEgov", () => ({
  useAdminEgov: () => ({ data: undefined }),
}));
vi.mock("@/data/administration/useAdminDigitalSkills", () => ({
  useAdminDigitalSkills: () => ({ data: undefined }),
}));
vi.mock("@/data/administration/useAdminServiceQuality", () => ({
  useAdminServiceQuality: () => ({ data: undefined }),
}));
vi.mock("@/data/administration/useAdminServices", () => ({
  useAdminServices: () => ({ data: undefined }),
}));
// The e-government procurement fold and the shared sector charts fetch on their
// own; neither carries the year label under test.
vi.mock("@/data/procurement/useAwarderGroupModel", () => ({
  useAwarderGroupModel: () => ({ model: null, byUnit: [] }),
}));
vi.mock("@/screens/sector/SectorCharts", () => ({
  SectorSpendByYearTile: () => null,
  SectorTopContractorsTile: () => null,
}));
vi.mock("./DigitalSkillsTiles", () => ({ DigitalSkillsStub: () => null }));
vi.mock("@/screens/components/procurement/SectorBreadcrumb", () => ({
  SectorBreadcrumb: () => null,
}));
vi.mock("@/ux/Title", () => ({
  Title: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));

const { AdministrationScreen } = await import("./AdministrationScreen");

const at = (url: string) =>
  render(<AdministrationScreen />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[url]}>
        <TooltipProvider>{children}</TooltipProvider>
      </MemoryRouter>
    ),
  });

const picker = () => screen.getByRole("combobox");
const nsPill = () => screen.getByRole("button", { name: "Latest year" });
/** The headline headcount KPI card — which report year the page actually
 *  counted. Scoped to the card so the full-history tiles below (which print
 *  every year's total) cannot satisfy the assertion by accident. */
const headcount = () =>
  screen.getByText("Positions").closest(".rounded-xl")?.textContent ?? "";

describe("AdministrationScreen scope", () => {
  it("counts the latest report year by default", () => {
    at("/sector/administration");
    expect(nsPill()).toHaveAttribute("aria-pressed", "true");
    expect(headcount()).toContain("145,623");
  });

  it("shows the year it counted when the report covers it", () => {
    at("/sector/administration?pscope=y:2023");
    expect(picker()).toHaveTextContent("2023");
    expect(headcount()).toContain("143,502");
  });

  it("falls back to the latest year — pill included — for a year the report lacks", () => {
    // THE REGRESSION. `y:2026` is a valid procurement scope and beyond the last
    // Доклад. The numbers revert to 2024, so the control must say "Latest year"
    // rather than paint blank over a page whose hints once claimed 2026.
    at("/sector/administration?pscope=y:2026");
    expect(nsPill()).toHaveAttribute("aria-pressed", "true");
    expect(picker()).not.toHaveTextContent(/\d{4}/);
    expect(headcount()).toContain("145,623");
  });

  it("treats an inbound full-corpus scope as the latest year", () => {
    // The page has no cross-year aggregate (allowAll is off), so "all" — which
    // /procurement offers freely — has to land somewhere it can actually render.
    at("/sector/administration?pscope=all");
    expect(nsPill()).toHaveAttribute("aria-pressed", "true");
    expect(headcount()).toContain("145,623");
  });
});
