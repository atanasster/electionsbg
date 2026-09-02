// InterregTile's render branching — the movers-only default view, the "see all
// municipalities" expansion, and the click-through into each place's own
// Interreg breakdown on the governance dashboard.
//
// What matters here is not layout: it is that the CAPTION above a list always
// describes the rows actually rendered beneath it — the "who climbs" heading
// must not survive into the expanded "every municipality" view, most of whose
// rows never moved rank at all.

import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus as bg } from "@/locales/allKeys";
import type { InterregOverview, FundsMuniRank } from "@/data/funds/types";

const hook = vi.hoisted(() => ({
  overview: null as InterregOverview | null,
  ranking: null as FundsMuniRank | null,
}));

vi.mock("@/data/funds/useInterreg", async (orig) => ({
  ...(await orig<typeof import("@/data/funds/useInterreg")>()),
  useInterregOverview: () => ({ data: hook.overview ?? undefined }),
  useFundsMuniRank: () => ({ data: hook.ranking ?? undefined }),
}));

vi.mock("@/data/municipalities/useMunicipalities", () => ({
  useMunicipalities: () => ({
    municipalities: [],
    // Mirrors the real hook's fallback: an unresolved code renders as itself.
    findMunicipality: () => undefined,
  }),
}));

const { InterregTile } = await import("./InterregTile");

// The SHIPPED bundle, so `t()` resolves real Bulgarian sentences rather than
// bare keys — the assertions below check what a reader actually sees.
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "bg",
    fallbackLng: "bg",
    resources: { bg: { translation: bg } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

const muni = (
  over: Partial<FundsMuniRank["munis"][number]> = {},
): FundsMuniRank["munis"][number] => ({
  obshtina: "DOB03",
  population: 1000,
  isunEur: 0,
  interregEur: 100_000,
  totalEur: 100_000,
  perCapitaEur: 100,
  rank: 1,
  rankBefore: 1,
  rankDelta: 0,
  ...over,
});

const overview = (over: Partial<InterregOverview> = {}): InterregOverview => ({
  budgetEur: 396_390_000,
  partnerCount: 1493,
  operationCount: 1115,
  programmeCount: 19,
  placedCount: 1469,
  unpublishedPartnerCount: 21,
  periods: {},
  programmes: [],
  ...over,
});

// 8 tied-rank fillers so the default fixture holds more than MOVERS_SHOWN (10)
// Interreg-holding municipalities — otherwise the "see all" toggle never
// appears and the expansion tests below would have no button to click.
const fillers = Array.from({ length: 8 }, (_, i) =>
  muni({
    obshtina: `FIL0${i}`,
    interregEur: 1_000,
    rank: 200 + i,
    rankBefore: 200 + i,
    rankDelta: 0,
  }),
);

const ranking = (over: Partial<FundsMuniRank> = {}): FundsMuniRank => ({
  cohortSize: 256,
  movedCount: 2,
  withInterregCount: 11,
  excluded: { ranked: { rows: 256, eur: 0 } },
  excludedIsunEur: 0,
  munis: [
    muni({
      obshtina: "DOB03",
      interregEur: 300_000,
      rankBefore: 66,
      rank: 23,
      rankDelta: 43,
    }),
    muni({
      obshtina: "BLG04",
      interregEur: 200_000,
      rankBefore: 90,
      rank: 50,
      rankDelta: 40,
    }),
    // A place Interreg reaches but whose rank did not move — must be invisible
    // in the default (movers-only) view and visible only once expanded.
    muni({
      obshtina: "VAR05",
      interregEur: 50_000,
      rankBefore: 12,
      rank: 12,
      rankDelta: 0,
    }),
    ...fillers,
  ],
  ...over,
});

const mount = () =>
  render(<InterregTile />, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={["/funds/interreg"]}>
        {children}
      </MemoryRouter>
    ),
  });

beforeEach(() => {
  hook.overview = overview();
  hook.ranking = ranking();
});

describe("nothing to report", () => {
  it("renders nothing when the overview has no Bulgarian partners", () => {
    hook.overview = overview({ partnerCount: 0 });
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the movers-only default view", () => {
  it("shows only municipalities whose rank moved, not every recipient", () => {
    mount();
    expect(screen.getByText("DOB03")).toBeTruthy();
    expect(screen.getByText("BLG04")).toBeTruthy();
    // VAR05 holds Interreg money but tied its rank (rankDelta 0) — not a mover.
    expect(screen.queryByText("VAR05")).toBeNull();
  });

  it("links each row to that place's own Interreg section", () => {
    mount();
    const link = screen.getByText("DOB03").closest("a");
    expect(link?.getAttribute("href")).toBe(
      "/governance/DOB03#myarea-interreg",
    );
  });
});

describe("the see-all expansion", () => {
  it("reveals every municipality with Interreg money on click", () => {
    mount();
    expect(screen.queryByText("VAR05")).toBeNull();

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText("VAR05")).toBeTruthy();
  });

  it("swaps the heading so it never claims 'who climbs' about a tied-rank row", () => {
    mount();
    expect(screen.getByText(/Кой се изкачва/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.queryByText(/Кой се изкачва/u)).toBeNull();
    expect(
      screen.getByText(/Всички общини с финансиране по Interreg/u),
    ).toBeTruthy();
  });

  it("collapses back to the movers-only view on a second click", () => {
    mount();
    const button = () => screen.getByRole("button");
    fireEvent.click(button());
    expect(screen.getByText("VAR05")).toBeTruthy();
    fireEvent.click(button());
    expect(screen.queryByText("VAR05")).toBeNull();
  });

  it("hides the toggle when there is nothing more to reveal", () => {
    hook.ranking = ranking({
      withInterregCount: 2,
      munis: [
        muni({ obshtina: "DOB03", rankDelta: 43 }),
        muni({ obshtina: "BLG04", rankDelta: 40 }),
      ],
    });
    mount();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

const programme = (
  over: Partial<InterregOverview["programmes"][number]> = {},
): InterregOverview["programmes"][number] => ({
  code: "INTERREG-ROBG-1420",
  nameBg: "ИНТЕРРЕГ V-A Румъния - България 2014-2020",
  nameEn: "INTERREG V-A Romania-Bulgaria",
  period: "2014-2020",
  budgetEur: 130_933_260,
  partnerCount: 226,
  operationCount: 169,
  ...over,
});

// 9 programmes so the default view (6 shown) has 3 more to reveal.
const manyProgrammes = Array.from({ length: 9 }, (_, i) =>
  programme({
    code: `INTERREG-TEST-${i}`,
    nameBg: `Тестова програма ${i}`,
    nameEn: `Test programme ${i}`,
    budgetEur: 9_000_000 - i * 100_000,
  }),
);

describe("the programmes see-all expansion", () => {
  beforeEach(() => {
    hook.overview = overview({ programmeCount: 9, programmes: manyProgrammes });
  });

  it("shows only the top PROGRAMMES_SHOWN by default, each linking to its own page", () => {
    mount();
    expect(screen.getByText("Тестова програма 0")).toBeTruthy();
    expect(screen.queryByText("Тестова програма 8")).toBeNull();
    const link = screen.getByText("Тестова програма 0").closest("a");
    expect(link?.getAttribute("href")).toBe(
      "/funds/interreg/programme/INTERREG-TEST-0",
    );
  });

  it("reveals every programme on click, using the server's total rather than the fetched array length", () => {
    mount();
    const toggle = screen.getByText(/Виж всички 9 програми/u);
    fireEvent.click(toggle);
    expect(screen.getByText("Тестова програма 8")).toBeTruthy();
  });

  it("swaps the heading so it never claims 'largest 6 of 9' once every row is shown", () => {
    mount();
    expect(screen.getByText(/По програми/u)).toBeTruthy();

    fireEvent.click(screen.getByText(/Виж всички 9 програми/u));

    expect(screen.queryByText(/По програми/u)).toBeNull();
    expect(screen.getByText(/Всички програми \(9\)/u)).toBeTruthy();
  });

  it("hides the toggle when there are no more programmes to reveal", () => {
    // Query for the PROGRAMMES toggle specifically — the default `ranking()`
    // fixture (shared by the municipalities describe block above) still
    // renders its own "see all municipalities" toggle here.
    hook.overview = overview({
      programmeCount: 3,
      programmes: manyProgrammes.slice(0, 3),
    });
    mount();
    expect(screen.queryByText(/Виж всички.*програми/u)).toBeNull();
  });

  it("never promises more programmes than the fetched array can actually show", () => {
    // programmeCount (30) exceeds the array the tile actually holds (9) —
    // the shape a corpus growing past the requested fetch limit produces.
    // The displayed total must clamp to what visibleProgrammes can render,
    // not repeat the server's unbounded count.
    hook.overview = overview({
      programmeCount: 30,
      programmes: manyProgrammes,
    });
    mount();
    fireEvent.click(screen.getByText(/Виж всички \d+ програми/u));
    expect(screen.getByText(/Всички програми \(9\)/u)).toBeTruthy();
    expect(screen.queryByText(/Всички програми \(30\)/u)).toBeNull();
  });
});
