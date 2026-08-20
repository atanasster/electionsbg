// The two procurement tiles' COPY and their render conditions.
//
// THE REGRESSION (2026-08-20 audit): the biggest-contracts card was titled
// „Най-големи кампании" over a list that is unfiltered by CPV — so on a narrow
// scope its top rows are event-staging transfers to municipalities or plain
// operational buys, and advertising is only about half the corpus anyway. Its own
// caption always said „най-скъпите отделни договори"; the title promised
// campaigns. Same defect as TourismSpendVsNightsTile's legend, one tile over —
// and the one title in that change with no gate, so reverting it passed every
// test in the repo.
//
// The second describe covers why TourismSpendVsNightsTile's caption may not point
// at „Разход по кампании": that tile is ?pscope-scoped and self-suppresses below
// two categories, which is the state of the page's DEFAULT scope.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

let lang = "bg";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    get i18n() {
      return { language: lang };
    },
  }),
}));

// The visitor tiles fetch their own artifact and are not the subject here.
vi.mock("./TourismSeasonalityTile", () => ({
  TourismSeasonalityTile: () => null,
}));
vi.mock("./TourismSourceMarketsTile", () => ({
  TourismSourceMarketsTile: () => null,
}));
vi.mock("./TourismSpendVsNightsTile", () => ({
  TourismSpendVsNightsTile: () => null,
}));
vi.mock("@/data/scope/useScopeWindow", () => ({
  useScopeWindow: () => ({ from: null, to: null }),
}));

// One CPV bucket only — the DEFAULT-scope shape, where МТ's whole window is five
// advertising contracts. `categories` is what CampaignCategoriesTile reads.
let categories: { id: string; totalEur: number; contractCount: number }[] = [
  { id: "advertising", totalEur: 312500, contractCount: 5 },
];
vi.mock("@/data/procurement/useAwarderGroupModel", () => ({
  useAwarderGroupModel: () => ({
    model: { totalEur: 312500, categories, suppliers: [], years: [] },
    byUnit: [],
    groupTotalEur: 312500,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/data/procurement/useAwarderContracts", () => ({
  useAwarderContracts: () => ({
    data: {
      contracts: [
        {
          key: "a",
          tag: "contract",
          date: "2026-05-12",
          amountEur: 75000,
          title: "Организация и провеждане на събития",
          contractorEik: "000696327",
          contractorName: "Столична Община",
          numberOfTenderers: 1,
        },
        {
          key: "b",
          tag: "contract",
          date: "2026-05-13",
          amountEur: 50000,
          title: "Реализиране на рекламни активности",
          contractorEik: "204663621",
          contractorName: "Фест продакшън ЕООД",
          numberOfTenderers: 1,
        },
      ],
    },
    isLoading: false,
  }),
  scopeByWindow: <T extends { date?: string }>(
    rows: T[],
    from: string | null,
    to: string | null,
  ): T[] =>
    rows.filter(
      (c) => (!from || (c.date ?? "") >= from) && (!to || (c.date ?? "") < to),
    ),
}));

const { TourismThematicTiles } = await import("./TourismThematicTiles");

const show = () =>
  render(
    <MemoryRouter>
      <TourismThematicTiles />
    </MemoryRouter>,
  );

describe("the biggest-contracts card", () => {
  it("says договори, never кампании", () => {
    lang = "bg";
    show();
    expect(screen.getByText("Най-големи договори")).toBeInTheDocument();
    expect(screen.queryByText("Най-големи кампании")).not.toBeInTheDocument();
    // The caption always said this; the title now agrees with it.
    expect(
      screen.getByText(/Най-скъпите отделни договори в обхвата/),
    ).toBeInTheDocument();
  });

  it("says the same thing in English", () => {
    lang = "en";
    show();
    expect(screen.getByText("Biggest contracts")).toBeInTheDocument();
    expect(screen.queryByText("Biggest campaigns")).not.toBeInTheDocument();
  });
});

describe("the campaign-categories card", () => {
  it("suppresses itself at one category — the DEFAULT-scope state", () => {
    // This is why the spend↔nights caption names no sibling tile. МТ's current
    // parliament window is five advertising contracts and nothing else, so the
    // split has nothing to split and the card is absent from the page a reader
    // most often sees.
    lang = "bg";
    categories = [{ id: "advertising", totalEur: 312500, contractCount: 5 }];
    show();
    expect(screen.queryByText("Разход по кампании")).not.toBeInTheDocument();
  });

  it("renders once there are two", () => {
    // The non-vacuity half: without it the assertion above passes on any tile
    // that never renders at all.
    lang = "bg";
    categories = [
      { id: "advertising", totalEur: 200000, contractCount: 3 },
      { id: "events", totalEur: 112500, contractCount: 2 },
    ];
    show();
    expect(screen.getByText("Разход по кампании")).toBeInTheDocument();
  });
});
