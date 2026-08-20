// The tile's COPY — the half no source scan and no data test can reach.
//
// THE REGRESSION (2026-08-20 audit, F2): the title read „Реклама и чужди нощувки"
// and the legend „разход за реклама (€)" while the bars summed EVERY МТ contract.
// Advertising is 51.0% of that corpus — €14.69M of €28.78M — so the legend named a
// quantity about half the size of the bar it labelled. Both halves were
// individually defensible (the sum matches the KPI row and the hub; „реклама" is
// the sector's largest line) which is exactly why nothing caught it: no total was
// wrong, only the sentence.
//
// The fixture below is the shape that makes the old copy false — a year whose
// spend is mostly NOT advertising — so an assertion here is about the words and
// not about arithmetic.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let lang = "bg";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    get i18n() {
      return { language: lang };
    },
  }),
}));

// Two advertising contracts and three operational ones: 60k of 150k is CPV 7934x,
// the rest fuel, cleaning and electricity. A tile that labels the bars „реклама"
// is overstating this year by 2.5x.
// Only `useAwarderContracts` is stubbed — the tile imports nothing else from this
// module. A passthrough `scopeByWindow` used to sit here too: unreachable, and
// with the window params dropped from its signature, so if the tile ever adopts
// ?pscope it would have silently disabled the window while the tests stayed green.
vi.mock("@/data/procurement/useAwarderContracts", () => ({
  useAwarderContracts: () => ({
    data: {
      contracts: [
        {
          key: "a",
          tag: "contract",
          date: "2024-03-01",
          amountEur: 40000,
          cpv: "79341000",
        },
        {
          key: "b",
          tag: "contract",
          date: "2024-06-01",
          amountEur: 20000,
          cpv: "79342000",
        },
        {
          key: "c",
          tag: "contract",
          date: "2024-07-01",
          amountEur: 50000,
          cpv: "09134200",
        },
        {
          key: "d",
          tag: "contract",
          date: "2025-02-01",
          amountEur: 30000,
          cpv: "90910000",
        },
        {
          key: "e",
          tag: "contract",
          date: "2025-05-01",
          amountEur: 10000,
          cpv: "09310000",
        },
        // An amendment, which must NOT be counted — that exclusion is what keeps
        // this series equal to the KPI row's basis.
        {
          key: "f",
          tag: "contractAmendment",
          date: "2025-05-01",
          amountEur: 999999,
          cpv: "79341000",
        },
      ],
    },
    isLoading: false,
  }),
}));

vi.mock("@/data/tourism/useTourismVisitors", () => ({
  useTourismVisitors: () => ({
    data: {
      annualForeign: [
        { year: 2023, nights: 14200230 },
        { year: 2024, nights: 16000000 },
        { year: 2025, nights: 17000000 },
      ],
      seasonality: [],
      sourceMarkets: [],
    },
    isLoading: false,
  }),
}));

const { TourismSpendVsNightsTile } = await import("./TourismSpendVsNightsTile");

describe("TourismSpendVsNightsTile — what the bars are called", () => {
  it("names МТ's contracts, never „реклама“", () => {
    lang = "bg";
    render(<TourismSpendVsNightsTile />);
    expect(
      screen.getByText("Разход на МТ и чужди нощувки"),
    ).toBeInTheDocument();
    expect(screen.getByText(/договори на МТ \(€\)/)).toBeInTheDocument();
    // The words that made the old copy false. „Рекламата е около половината" in
    // the caption is allowed — and asserted below — so match the LEGEND's phrase
    // and the old title, not the substring „реклама" on its own.
    expect(screen.queryByText(/разход за реклама/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("Реклама и чужди нощувки"),
    ).not.toBeInTheDocument();
  });

  it("says advertising is only about half — and on what basis", () => {
    // Dropping the qualifier is the silent way back to the old claim: the title
    // would be accurate and the reader would still take the bars for the
    // marketing line, because that is what the sector is known for.
    //
    // „по CPV" is load-bearing, not filler. Under the page's own narrow
    // definition advertising is 51.0%; counting trade-fair stands and rented ad
    // space — which any reader calls advertising — it is 73.3%. A bare „half"
    // picks one of those silently.
    //
    // And the caption deliberately names NO sibling tile: CampaignCategoriesTile
    // self-suppresses below two categories, and on the page's DEFAULT scope МТ has
    // exactly one, so a „see X" pointer would dangle on the most common view.
    lang = "bg";
    render(<TourismSpendVsNightsTile />);
    expect(
      screen.getByText(/Рекламата е около половината от този разход по CPV/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Разход по кампании/)).not.toBeInTheDocument();
  });

  it("says the same thing in English, qualifier included", () => {
    // BG and EN are two independent string literals, so a mutation that deletes
    // the „about half" qualifier from one arm is invisible to a test that only
    // reads the other. The BG assertion above covers half the surface.
    lang = "en";
    render(<TourismSpendVsNightsTile />);
    expect(
      screen.getByText("MT contract spend vs foreign nights"),
    ).toBeInTheDocument();
    expect(screen.getByText(/MT contracts \(€\)/)).toBeInTheDocument();
    expect(screen.queryByText(/marketing spend \(€\)/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Advertising is about half of that spend by CPV/),
    ).toBeInTheDocument();
    expect(screen.getByText(/procurement, 2023–2025/)).toBeInTheDocument();
  });

  it("names the years it plots, and never claims to plot all of them", () => {
    // THE REGRESSION this arm exists for: the axis comes from Eurostat's
    // annualForeign, so a contract year Eurostat does not cover is absent rather
    // than zero — on the live corpus 77 contracts / €3.79M / 13.2%. For one commit
    // the caption said „Всички договори на МТ по година", which is false by that
    // much. The fixture's 2014 row is outside the Eurostat range for exactly this.
    lang = "bg";
    render(<TourismSpendVsNightsTile />);
    expect(screen.getByText(/ЗОП, 2023–2025/)).toBeInTheDocument();
    expect(screen.queryByText(/Всички договори/)).not.toBeInTheDocument();
    // …and the out-of-range row really is dropped rather than folded into a bar.
    expect(screen.queryByTitle(/^2014:/)).not.toBeInTheDocument();
    expect(screen.getAllByTitle(/^20\d\d:/)).toHaveLength(3);
  });

  it("excludes amendments, so the series shares the KPI row's basis", () => {
    // The €999,999 amendment in the fixture is 87% of everything. If it were
    // counted, the 2025 bar's tooltip would show it — and the tile would be
    // plotting a different „МТ spend" from the number above it.
    lang = "bg";
    render(<TourismSpendVsNightsTile />);
    // ⚠ Reads the native `title=` tooltip. That attribute is pre-existing debt —
    // the house pattern is the shared useTooltip hook — so if this tile migrates,
    // re-anchor here rather than assuming the assertion broke.
    const bar2025 = screen
      .getAllByTitle(/^2025:/)
      .map((el) => el.getAttribute("title"))
      .join("|");
    expect(bar2025).toMatch(/^2025: 40/); // 40k, not 1.04M
  });
});
