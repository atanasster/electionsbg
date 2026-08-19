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
// own, so they stay render-free here. The leaderboard stub CAPTURES its props
// rather than discarding them: the defect this screen last shipped was a WIRING
// one — the tile could label a public-body contractor and the screen never asked
// it to, so „Информационно обслужване" АД (a company whose принципал is the
// ministry leading this sector) topped the list looking like a private vendor.
// With `() => null` both prop lines could be deleted and every test in the repo
// would still pass.
const topContractorsProps = vi.fn();
const spendByYearProps = vi.fn();
const groupModelWindows = vi.fn();

// ⚠ The two group-model calls must return DISTINGUISHABLE models. With one
// object for both, swapping `moneyModel` and `moneyHistory` at the call sites —
// which puts the whole corpus straight back into the year-labelled KPIs, i.e.
// reintroduces the exact regression this screen just fixed — passes every
// assertion. The window is the discriminator, so the stub keys on it.
const YEAR_MODEL_EUR = 173_000_000;
const CORPUS_MODEL_EUR = 336_000_000;
const modelFor = (eur: number) => ({
  totalEur: eur,
  contractCount: 1,
  suppliers: [],
  years: [
    { year: 2023, totalEur: 1, contractCount: 1, byCategory: {} },
    { year: 2024, totalEur: 2, contractCount: 1, byCategory: {} },
  ],
  categories: [],
  supplierCount: 0,
  bidKnownN: 0,
  singleBidN: 0,
  singleBidShare: null,
  directEur: 0,
  directShare: 0,
  minYear: null,
  maxYear: null,
});
vi.mock("@/data/procurement/useAwarderGroupModel", () => ({
  useAwarderGroupModel: (
    _eiks: readonly string[],
    _build: unknown,
    window: { from: string | null; to: string | null },
    enabled: boolean,
  ) => {
    groupModelWindows(window, enabled);
    if (!enabled) return { model: null, byUnit: [], isLoading: false };
    return {
      model: modelFor(window.from == null ? CORPUS_MODEL_EUR : YEAR_MODEL_EUR),
      byUnit: [],
      isLoading: false,
    };
  },
}));
// Both stubs stay render-free — the shared sector charts fetch on their own —
// but they CAPTURE their props. The defect this screen last shipped was a
// wiring one, and with `() => null` the prop lines could be deleted with every
// test in the repo still green.
vi.mock("@/screens/sector/SectorCharts", () => ({
  SectorSpendByYearTile: (p: Record<string, unknown>) => {
    spendByYearProps(p);
    return null;
  },
  SectorTopContractorsTile: (p: Record<string, unknown>) => {
    topContractorsProps(p);
    return null;
  },
}));
vi.mock("./DigitalSkillsTiles", () => ({ DigitalSkillsStub: () => null }));
vi.mock("@/screens/components/procurement/SectorBreadcrumb", () => ({
  SectorBreadcrumb: () => null,
}));
vi.mock("@/ux/Title", () => ({
  Title: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));

const { AdministrationScreen } = await import("./AdministrationScreen");
const { ADMIN_SECTOR_EIKS, ADMIN_STATE_BODY_CONTRACTORS } =
  await import("@/lib/administrationReferenceData");

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

describe("AdministrationScreen — the leaderboard's label sets", () => {
  it("hands the tile both sets, so ИО does not render as a private vendor", () => {
    topContractorsProps.mockClear();
    at("/sector/administration");
    const props = topContractorsProps.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(props).toBeDefined();
    expect(props!.memberEiks).toEqual(ADMIN_SECTOR_EIKS);
    expect(props!.stateBodyEiks).toBe(ADMIN_STATE_BODY_CONTRACTORS);
  });
});

// The money band answers for the year the pill names — and only the trend
// ignores it.
//
// THE REGRESSION: the window used to be {from:null,to:null} on every non-`y:`
// scope, i.e. on the DEFAULT view. So under a pill reading „Най-нова година",
// beside institution tiles showing 2025, the KPIs published the WHOLE CORPUS —
// €336.7M / 416 / 134 against 2025's own €173.1M / 97 / 40. Both figures were
// correct; the page just answered a different question from the one its control
// was asking, and said so nowhere.
describe("AdministrationScreen — the money window follows the pill", () => {
  const windows = () =>
    groupModelWindows.mock.calls.map(
      (c) => c[0] as { from: string | null; to: string | null },
    );

  it("scopes the KPIs to the latest report year on the default view", () => {
    groupModelWindows.mockClear();
    at("/sector/administration");
    // Derived from the fixture, not hardcoded: the default view resolves to the
    // report's own latest year, whatever that is.
    expect(windows()).toContainEqual({
      from: `${LATEST}-01-01`,
      to: `${LATEST + 1}-01-01`,
    });
  });

  it("follows an explicit year", () => {
    groupModelWindows.mockClear();
    at("/sector/administration?pscope=y:2023");
    expect(windows()).toContainEqual({
      from: "2023-01-01",
      to: "2024-01-01",
    });
    expect(windows()).not.toContainEqual({
      from: `${LATEST}-01-01`,
      to: `${LATEST + 1}-01-01`,
    });
  });

  // A trend is not a scoped figure: „Възложени по година" would collapse to a
  // single bar if it shared the KPIs' window.
  it("always fetches the full corpus too, for the spend-by-year trend", () => {
    groupModelWindows.mockClear();
    at("/sector/administration?pscope=y:2023");
    expect(windows()).toContainEqual({ from: null, to: null });
  });

  // The drill-down hangs off the KPI cards, so an all-time href would open a
  // browser showing 416 contracts under a card that just said 97.
  it("carries the same year into the contracts drill-down", () => {
    at("/sector/administration?pscope=y:2023");
    const link = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href")?.includes("sector=administration"));
    expect(link?.getAttribute("href")).toContain("pscope=y:2023");
  });
});

// The KPIs answer for the selected year; only the trend ignores it. Pinned by
// the models' € rather than by the call order, so swapping the two at the call
// sites fails here instead of passing silently.
describe("AdministrationScreen — each tile gets the right model", () => {
  it("gives the spend-by-year trend the FULL-CORPUS model", () => {
    spendByYearProps.mockClear();
    at("/sector/administration?pscope=y:2023");
    const p = spendByYearProps.mock.calls.at(-1)?.[0] as
      | { model: { totalEur: number } }
      | undefined;
    expect(p?.model.totalEur).toBe(CORPUS_MODEL_EUR);
  });

  it("gives the leaderboard the YEAR-SCOPED model", () => {
    topContractorsProps.mockClear();
    at("/sector/administration?pscope=y:2023");
    const p = topContractorsProps.mock.calls.at(-1)?.[0] as
      | { model: { totalEur: number } }
      | undefined;
    expect(p?.model.totalEur).toBe(YEAR_MODEL_EUR);
  });

  it("renders the year-scoped total, not the corpus one", () => {
    at("/sector/administration?pscope=y:2023");
    expect(screen.getByText(/173/)).toBeInTheDocument();
    expect(screen.queryByText(/336/)).not.toBeInTheDocument();
  });

  // `selYear` falls back to the CURRENT calendar year while the report is in
  // flight — a year the picker never offers. An ungated fetch paints real
  // contracts under that label and caches them for the session.
  it("asks for nothing until the report has loaded", () => {
    groupModelWindows.mockClear();
    at("/sector/administration");
    for (const [, enabled] of groupModelWindows.mock.calls)
      expect(enabled).toBe(true);
  });
});
