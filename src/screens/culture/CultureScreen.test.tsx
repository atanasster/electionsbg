// /culture is where this bug was reported: `?pscope=y:<year>` arrives from any
// other public-money section (the param rides on ordinary in-app links), and the
// dashboard re-aggregates every film KPI to that year client-side. When the year
// is one the НФЦ register does not cover, the aggregation falls back to
// all-years — so the SCOPE CONTROL has to fall back with it. It used to paint
// blank, leaving the page reading as its "Всички години" default.
//
// These render the real screen with the two data hooks stubbed (the tiles below
// the hero fetch on their own and are stubbed out; the hero is what carries the
// scoped numbers) and assert the one invariant: what the picker says and what
// the KPIs count are the same window.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactNode } from "react";
import type {
  CultureFilmsFile,
  CultureOverviewFile,
  FilmAward,
} from "@/data/culture/types";

const film = (
  year: number,
  subsidyEur: number,
  producer: string,
): FilmAward => ({
  year,
  title: `Филм ${year} ${producer}`,
  regNo: `И-${year}-${producer}`,
  producer,
  producerFold: producer.toLowerCase(),
  discipline: "feature",
  subsidyBgn: subsidyEur * 1.95583,
  subsidyEur,
});

// Two years only, so an all-years total can never be confused with a scoped one.
const FILMS = [
  film(2024, 100_000, "Едно"),
  film(2024, 300_000, "Две"),
  film(2025, 700_000, "Три"),
];
const TOTAL_ALL = 1_100_000;
const TOTAL_2024 = 400_000;

const overview: CultureOverviewFile = {
  generatedAt: "2026-07-30",
  source: { publisher: "НФЦ", url: "https://nfc.bg", description: "регистър" },
  totalEur: TOTAL_ALL,
  filmCount: 3,
  producerCount: 3,
  firstYear: 2024,
  lastYear: 2025,
  byYear: [
    { year: 2024, eur: TOTAL_2024, count: 2 },
    { year: 2025, eur: 700_000, count: 1 },
  ],
  byDiscipline: [{ discipline: "feature", eur: TOTAL_ALL, count: 3 }],
  topProducers: [],
  top10Share: 1,
};
const films: CultureFilmsFile = {
  generatedAt: "2026-07-30",
  source: overview.source,
  firstYear: 2024,
  lastYear: 2025,
  films: FILMS,
};

vi.mock("@/data/culture/useCulture", () => ({
  useCultureOverview: () => ({
    data: overview,
    isLoading: false,
    isError: false,
  }),
  useCultureFilms: () => ({ data: films, isLoading: false, isError: false }),
}));

// The tiles below the hero each fetch their own dataset; none of them is under
// test here, and rendering them would need the whole query/leaflet stack.
vi.mock("./CultureCompositionTile", () => ({
  CultureCompositionTile: () => null,
}));
vi.mock("./CultureTimeSpineTile", () => ({ CultureTimeSpineTile: () => null }));
vi.mock("./CultureConcentrationTile", () => ({
  CultureConcentrationTile: () => null,
}));
vi.mock("./CultureFilmAwardsTile", () => ({
  // Stands in for the awards tile, which takes the year-filtered film list —
  // the half of the page that used to disagree with everything else.
  CultureFilmAwardsTile: ({ films: rows }: { films: FilmAward[] }) => (
    <div data-testid="awards">{rows.length}</div>
  ),
}));
vi.mock("./CultureScaleTile", () => ({ CultureScaleTile: () => null }));
vi.mock("./CultureMunicipalTile", () => ({ CultureMunicipalTile: () => null }));
vi.mock("./CultureCommissionsTile", () => ({
  CultureCommissionsTile: () => null,
}));
vi.mock("./CultureGrantsTile", () => ({ CultureGrantsTile: () => null }));
vi.mock("./CultureOblastMapTile", () => ({ CultureOblastMapTile: () => null }));
vi.mock("./CultureAwardersTile", () => ({ CultureAwardersTile: () => null }));
vi.mock("@/screens/components/procurement/SectorBreadcrumb", () => ({
  SectorBreadcrumb: () => null,
}));
vi.mock("@/ux/Title", () => ({
  Title: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));
const { CultureScreen } = await import("./CultureScreen");

// The KPI cards carry Radix tooltips; main.tsx mounts the provider app-wide.
const at = (url: string) =>
  render(<CultureScreen />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[url]}>
        <TooltipProvider>{children}</TooltipProvider>
      </MemoryRouter>
    ),
  });

/** The years picker's rendered text — what the reader reads as "the scope". */
const picker = () => screen.getByRole("combobox");
const nsPill = () => screen.getByRole("button", { name: "All years" });
/** The hero's span line, printed from the AGGREGATED overview (`scoped`) — the
 *  cheapest witness of which window the numbers actually cover. */
const aggregatedSpan = () =>
  screen.getByText(/National Film Center ·/).textContent ?? "";
const awardsCount = () => screen.getByTestId("awards").textContent;

describe("CultureScreen scope", () => {
  it("defaults to all years", () => {
    at("/culture");
    expect(nsPill()).toHaveAttribute("aria-pressed", "true");
    expect(aggregatedSpan()).toContain("2024–2025");
    expect(awardsCount()).toBe("3");
  });

  it("shows the year it aggregated when the register covers it", () => {
    at("/culture?pscope=y:2024");
    expect(picker()).toHaveTextContent("2024");
    expect(nsPill()).toHaveAttribute("aria-pressed", "false");
    expect(aggregatedSpan()).toContain("· 2024");
    expect(awardsCount()).toBe("2");
  });

  it("falls back to all years — in the control too — for a year it cannot serve", () => {
    // THE REPORTED BUG. `y:2019` is a valid procurement scope and outside the
    // film register: the KPIs revert to all-years, so the control must say
    // "all years" rather than paint blank, and the awards tile must not filter
    // to an empty year behind an all-years headline.
    at("/culture?pscope=y:2019");
    expect(nsPill()).toHaveAttribute("aria-pressed", "true");
    expect(picker()).not.toHaveTextContent(/\d{4}/);
    expect(aggregatedSpan()).toContain("2024–2025");
    expect(awardsCount()).toBe("3");
  });

  it("treats an inbound full-corpus scope as its own all-years default", () => {
    at("/culture?pscope=all");
    expect(nsPill()).toHaveAttribute("aria-pressed", "true");
    expect(aggregatedSpan()).toContain("2024–2025");
    expect(awardsCount()).toBe("3");
  });
});
