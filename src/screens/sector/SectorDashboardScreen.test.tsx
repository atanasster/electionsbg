// Two pieces of SectorDashboardScreen COPY that no source scan can reach.
//
// 1. The buy-side link. `?sector=` filters the browse table by the sector's whole
//    EIK roster, so naming the lead institution is only true when the lead IS the
//    roster. Inverting that branch renders „Обществените поръчки на МВР" over a
//    table holding 73 other directorates: a wrong claim about whose contracts the
//    reader is looking at, and one that looks perfectly fine on the single-member
//    page a developer opens.
// 2. The leaderboard's label sets and the „Топ изпълнител" qualifier. The
//    measurement behind the tourism case lives on TOURISM_STATE_BODY_CONTRACTORS;
//    what is tested here is the wiring and the words.
//
// ⚠️ EVERY `vi.mock` IN THIS FILE IS HOISTED ABOVE THE IMPORTS AND APPLIES TO THE
// WHOLE FILE, including the PackContractsLink block. They are collected here, in
// one place, for that reason — a mock parked beside the second describe reads as
// if it were scoped to it, and the next test added to the first block would
// inherit it with nothing nearby saying so.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { bgCorpus as bgDict } from "@/locales/allKeys";
import {
  PackContractsLink,
  SectorDashboardScreen,
} from "./SectorDashboardScreen";
import { TOURISM_STATE_BODY_CONTRACTORS } from "@/lib/tourismReferenceData";

// Mutable so the ENGLISH arm of the new copy is reachable — an i18n mock pinned
// to "bg" leaves every `bg ? … : …` branch in the screen half-covered, and the
// KPI qualifier has one per label.
let lang = "bg";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    get i18n() {
      return { language: lang };
    },
    t: (k: string) => (bgDict as Record<string, string>)[k] ?? k,
  }),
}));

// The leaderboard stub CAPTURES its props rather than discarding them: the defect
// this screen shipped was a WIRING one — the tile could label a public-body
// contractor and the screen never asked it to. With `() => null` the prop line
// could be deleted and every test in the repo would still pass.
const topContractorsProps = vi.fn();
vi.mock("./SectorCharts", () => ({
  SectorSpendByYearTile: () => null,
  SectorTopContractorsTile: (p: Record<string, unknown>) => {
    topContractorsProps(p);
    return null;
  },
}));
vi.mock("./SectorAwardersTile", () => ({ SectorAwardersTile: () => null }));
vi.mock("@/screens/components/procurement/SectorBreadcrumb", () => ({
  SectorBreadcrumb: () => null,
  SECTORS_HUB_PATH: "/governance/sectors",
}));
vi.mock("@/screens/components/ScopeControl", () => ({
  ScopeControl: () => null,
}));
vi.mock("@/data/scope/useScopeWindow", () => ({
  useScopeWindow: () => ({ from: "2026-04-19", to: null }),
}));
// Tourism's bespoke tiles are a real lazy() chunk. Left unmocked the assertions
// happen to pass because the dynamic import has not resolved yet — a timing
// accident, not a fixture. Stub it so the test does not depend on that.
vi.mock("./tourism/TourismThematicTiles", () => ({
  TourismThematicTiles: () => null,
}));

// The model the screen renders. Mutable so one fixture can reach BOTH layout arms
// (`spendTile && topTile` needs ≥2 years) and all three qualifier outcomes.
const SOFIA = "000696327"; // Столична община — curated state body, tops the default scope
const TOURISM_EIK = "176789478"; // the sector's own member
type Supplier = { eik: string; name: string; totalEur: number } & Record<
  string,
  unknown
>;
let years = [{ year: 2026, totalEur: 312500 }];
let suppliers: Supplier[] = [
  { eik: SOFIA, name: "Столична Община", totalEur: 75000 },
  { eik: "204663621", name: "Фест продакшън ЕООД", totalEur: 50000 },
];
vi.mock("@/data/procurement/useAwarderGroupModel", () => ({
  useAwarderGroupModel: () => ({
    model: {
      totalEur: 312500,
      contractCount: 5,
      supplierCount: suppliers.length,
      years,
      categories: [],
      suppliers,
    },
    byUnit: [{ eik: "176789478", totalEur: 312500 }],
    groupTotalEur: 312500,
    isLoading: false,
    isError: false,
  }),
}));

const wrap = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

const show = (memberN: number, bg = true) =>
  render(
    <PackContractsLink
      to={{ pathname: "/procurement/contracts", search: "?sector=customs" }}
      name={bg ? "Агенция „Митници“" : "Customs Agency"}
      memberN={memberN}
      bg={bg}
    />,
    { wrapper: wrap },
  );

describe("PackContractsLink", () => {
  it("names the institution when it IS the whole roster", () => {
    show(1);
    expect(
      screen.getByText(/Обществените поръчки на Агенция „Митници“/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/на сектора/)).not.toBeInTheDocument();
  });

  it("names the SECTOR, with a count, when the roster is wider", () => {
    show(74);
    expect(
      screen.getByText("Обществените поръчки на сектора"),
    ).toBeInTheDocument();
    expect(screen.getByText(/74 възложители/)).toBeInTheDocument();
    // The institution's name must not appear — that is the wrong claim.
    expect(screen.queryByText(/Агенция „Митници“/)).not.toBeInTheDocument();
  });

  it("treats 2 as wider, not as single", () => {
    // The boundary: health is a 2-member sector, so an `>= 2` typo here is live.
    show(2);
    expect(
      screen.getByText("Обществените поръчки на сектора"),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 възложители/)).toBeInTheDocument();
  });

  it("links to the destination it was given", () => {
    show(1);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/procurement/contracts?sector=customs",
    );
  });

  it("says the same thing in English", () => {
    show(74, false);
    expect(
      screen.getByText("Public contracts in this sector"),
    ).toBeInTheDocument();
    expect(screen.getByText(/What 74 awarders buy/)).toBeInTheDocument();
  });
});

describe("SectorDashboardScreen — the leaderboard's label sets", () => {
  const atTourism = () =>
    render(
      <MemoryRouter initialEntries={["/sector/tourism"]}>
        <Routes>
          <Route path="/sector/:id" element={<SectorDashboardScreen />} />
        </Routes>
      </MemoryRouter>,
    );

  const lastProps = () =>
    topContractorsProps.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;

  beforeEach(() => {
    lang = "bg";
    years = [{ year: 2026, totalEur: 312500 }];
    suppliers = [
      { eik: SOFIA, name: "Столична Община", totalEur: 75000 },
      { eik: "204663621", name: "Фест продакшън ЕООД", totalEur: 50000 },
    ];
    topContractorsProps.mockClear();
  });

  it("hands the tile the sector's curated state bodies", () => {
    atTourism();
    const props = lastProps();
    expect(props).toBeDefined();
    expect(props!.stateBodyEiks).toBe(TOURISM_STATE_BODY_CONTRACTORS);
    // …and the member set alongside it, since „в групата" outranks „държавно".
    expect(props!.memberEiks).toEqual([TOURISM_EIK]);
  });

  it("hands over the same sets in the two-chart grid layout", () => {
    // One year takes the fallback arm; two years takes the GRID arm, which is
    // what every sector with ≥2 years of spend renders — i.e. the layout readers
    // actually see. The prop list used to be written once per arm and only the
    // fallback copy was covered, so the grid copy could have been deleted with
    // the whole suite green. Building the tile once removed that class; this is
    // the render-side proof the grid layout still gets it.
    years = [
      { year: 2025, totalEur: 120000 },
      { year: 2026, totalEur: 192500 },
    ];
    atTourism();
    expect(lastProps()!.stateBodyEiks).toBe(TOURISM_STATE_BODY_CONTRACTORS);
  });
});

// The „Топ изпълнител" KPI's qualifier. The KPI is the bigger number and is read
// before the tile beneath it, so an unqualified „Столична Община" there
// contradicts the badged row below — and on a single-supplier scope the tile, its
// chip and its footnote are all absent, which is exactly when the misreading is
// worst. All three arms are covered plus the negative control: without one, a
// mutation that appends „· държавно" to every row passes.
describe("SectorDashboardScreen — the top-contractor qualifier", () => {
  const atTourism = () =>
    render(
      <MemoryRouter initialEntries={["/sector/tourism"]}>
        <Routes>
          <Route path="/sector/:id" element={<SectorDashboardScreen />} />
        </Routes>
      </MemoryRouter>,
    );

  beforeEach(() => {
    lang = "bg";
    years = [{ year: 2026, totalEur: 312500 }];
    suppliers = [
      { eik: SOFIA, name: "Столична Община", totalEur: 75000 },
      { eik: "204663621", name: "Фест продакшън ЕООД", totalEur: 50000 },
    ];
  });

  it("says „държавно“ for a curated state body", () => {
    atTourism();
    expect(screen.getByText("Столична Община")).toBeInTheDocument();
    expect(screen.getByText("· държавно")).toBeInTheDocument();
  });

  it("explains the word in a title, since the KPI carries no footnote", () => {
    // The tile's footnote only renders when the tile does. The qualifier is not
    // gated on that — a lone public-body supplier is the worst case, not a reason
    // to drop the label — so it has to define itself where it stands.
    atTourism();
    expect(screen.getByText("· държавно")).toHaveAttribute(
      "title",
      expect.stringContaining("трансфер вътре в държавата"),
    );
  });

  it("prefers „в групата“ when the top row is one of the sector's own", () => {
    suppliers = [
      { eik: TOURISM_EIK, name: "Министерство на туризма", totalEur: 90000 },
      { eik: SOFIA, name: "Столична Община", totalEur: 75000 },
    ];
    atTourism();
    expect(screen.getByText("· в групата")).toBeInTheDocument();
    expect(screen.queryByText("· държавно")).not.toBeInTheDocument();
  });

  it("says „консорциум“ for a consortium carrier, which needs no curation", () => {
    // `isConsortiumSupplier` reads the row itself, so every sector gets this
    // label. Dropping it was the one way the KPI could still disagree with the
    // tile about the same company.
    suppliers = [
      {
        eik: "obed-d9254a02da76",
        name: "Обединение: две фирми",
        totalEur: 90000,
      },
      { eik: SOFIA, name: "Столична Община", totalEur: 75000 },
    ];
    atTourism();
    expect(screen.getByText("· консорциум")).toBeInTheDocument();
  });

  it("adds NOTHING for an ordinary private vendor", () => {
    // The negative control. Without it a mutation that always appends a
    // qualifier passes every assertion above.
    suppliers = [
      { eik: "204663621", name: "Фест продакшън ЕООД", totalEur: 90000 },
      { eik: "831727361", name: "Апра ООД", totalEur: 75000 },
    ];
    atTourism();
    expect(screen.getByText("Фест продакшън ЕООД")).toBeInTheDocument();
    expect(screen.queryByText(/^· /)).not.toBeInTheDocument();
  });

  it("says the same thing in English", () => {
    lang = "en";
    atTourism();
    expect(screen.getByText("· state body")).toBeInTheDocument();
    expect(screen.queryByText("· държавно")).not.toBeInTheDocument();
  });
});
