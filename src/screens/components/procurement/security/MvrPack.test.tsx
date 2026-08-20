// The МВР pack's footnote prints a UNIT COUNT and a € in one sentence — „по N
// структури на Министерството на вътрешните работи (€X)". The two must describe
// the same group, and twice now they have not:
//
//   · the count was hardcoded to the roster size (74) while the € is scoped, so
//     the default scope read „по 74 структури … (€53,2 млн.)" against a page whose
//     own KPI said „Структури с договори: 23";
//   · the obvious fix, `units.length`, is universe-FILTERED while `groupTotalEur`
//     is filter-invariant, so 8 of the picker's 9 options would pair a narrowed
//     count with the whole group's money — worst case „по 1 структури …
//     (€1,9 млрд.)".
//
// Both are invisible to a type check and to every other test in the tree, which is
// what this file is for. `useMvr` is mocked so the two quantities can be made to
// disagree on purpose.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "bg" }, t: (k: string) => k }),
}));

// Every child tile is a fetching component; the footnote is what is under test.
vi.mock("./MvrDirectorateMap", () => ({ MvrDirectorateMap: () => null }));
vi.mock("./MvrBudgetBridgeTile", () => ({ MvrBudgetBridgeTile: () => null }));
vi.mock("./MvrPersonnelTile", () => ({ MvrPersonnelTile: () => null }));
vi.mock("./MvrEuPeerTile", () => ({ MvrEuPeerTile: () => null }));
vi.mock("./MvrCategoryTile", () => ({ MvrCategoryTile: () => null }));
vi.mock("./MvrCompetitionTile", () => ({ MvrCompetitionTile: () => null }));
vi.mock("./MvrTopContractsTile", () => ({ MvrTopContractsTile: () => null }));
vi.mock("./MvrOblastMapTile", () => ({ MvrOblastMapTile: () => null }));
vi.mock("./MvrRoadSafetyTile", () => ({ MvrRoadSafetyTile: () => null }));
vi.mock("./MvrCrimeScatterTile", () => ({ MvrCrimeScatterTile: () => null }));
vi.mock("./MvrTransparencyTile", () => ({ MvrTransparencyTile: () => null }));
vi.mock("../vik/VikContractorHhiTile", () => ({
  VikContractorHhiTile: () => null,
}));

const GROUP_TOTAL = 1_900_000_000;
// The active universe holds ONE unit; the whole group holds 23. A count taken from
// `units` would render 1 beside the €1.9bn below.
const ACTIVE_UNITS = [
  {
    eik: "129010125",
    name: "ГД Гранична полиция",
    universe: "border" as const,
    totalEur: 379_000_000,
    contractCount: 826,
    singleBidShare: 0.1,
    bidKnownN: 800,
  },
];
const WHOLE_GROUP_UNIT_COUNT = 23;

vi.mock("@/data/procurement/useMvr", () => ({
  useMvr: () => ({
    model: {
      totalEur: 379_000_000,
      contractCount: 826,
      minYear: 2011,
      maxYear: 2026,
      categories: [],
      suppliers: [],
      byYear: [],
      byMethod: [],
      singleBidN: 0,
      bidKnownN: 800,
    },
    units: ACTIVE_UNITS,
    groupEiks: ["129010125"],
    groupTotalEur: GROUP_TOTAL,
    groupUnitCount: WHOLE_GROUP_UNIT_COUNT,
    isLoading: false,
  }),
}));

vi.mock("@/lib/packInsights", () => ({ buildPackInsights: () => [] }));

import { MvrPack } from "./MvrPack";
import { MVR_EIK } from "@/lib/securityReferenceData";

const renderPack = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <MvrPack eik={MVR_EIK} scopeWindow={{ from: null, to: null }} />
      </TooltipProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("MvrPack footnote", () => {
  it("pairs the unit count with the whole group, not the active universe", () => {
    renderPack();
    const foot = screen.getByText(/Консолидиран изглед по/);
    // ⚠ THE MUTATION-RELEVANT ASSERTION. `units.length` is 1 here and
    // `groupUnitCount` is 23; reverting the fix makes this read „по 1 структури"
    // beside the €1.9bn, and the test fails. Asserting only "contains 23" would
    // pass for both if the two ever coincided, hence the paired negative below.
    expect(foot.textContent).toMatch(/по 23 структури/);
    expect(foot.textContent).not.toMatch(/по 1 структури/);
    // …and the € beside it really is the whole-group figure, so the two describe
    // one group. Without this the count could be right about a total that is not.
    expect(foot.textContent?.replace(/\s/g, " ")).toMatch(/€1,9\s?млрд/);
  });

  it("keeps the active-view count on the KPI that describes the active view", () => {
    renderPack();
    // „Структури с договори" has no whole-group figure beside it, so it correctly
    // follows the universe filter — the opposite rule to the footnote's, and the
    // reason the fix is not "replace units.length everywhere".
    // The StatCard's label and its value are siblings inside the card, so walk up
    // to the card rather than to the label's own parent.
    const card = screen
      .getByText("Структури с договори")
      .closest("a,[class*='rounded']");
    expect(card?.textContent).toMatch(/Структури с договори\s*1\b/);
    expect(card?.textContent).not.toMatch(/23/);
  });
});
