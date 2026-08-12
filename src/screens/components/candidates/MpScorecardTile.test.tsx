// The scorecard renders only the metrics it HAS. A dash is not a measurement — it is the
// absence of one — and four fixed tiles gave the reader no way to tell "this MP votes with
// their group 62% of the time" from "we hold no roll-call for the parliaments this MP sat
// in".
//
// The second case is the majority, not an edge. The roll-call corpus begins 2020-10-28
// (NS 44, and only its last five months), so of the 2,122 MPs in data/parliament/index.json
// 1,556 can never have a loyalty or attendance figure — 1,263 with no nsFolders at all plus
// 293 whose last parliament predates 44. Сергей Станишев (39/40 НС) is the worked example:
// three of four tiles read "—" under confident labels.
//
// Hermetic: the scorecard hook is stubbed, so this is a render test over the metric set.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, type RenderResult } from "@testing-library/react";
import type {
  MpScorecard,
  ScorecardMetric,
} from "@/data/parliament/useMpScorecard";

const scorecardHook = vi.fn();
vi.mock("@/data/parliament/useMpScorecard", () => ({
  useMpScorecard: () => scorecardHook(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { MpScorecardTile, type ScorecardLinks } from "./MpScorecardTile";
import { GRID_COLS, gridCols } from "./scorecardGrid";

const metric = (
  value: number | null,
  extra: Partial<ScorecardMetric> = {},
): ScorecardMetric =>
  ({
    value,
    rank: null,
    cohortSize: 0,
    median: null,
    ...extra,
  }) as ScorecardMetric;

const show = (
  v: Partial<Record<keyof MpScorecard, unknown>>,
  links?: ScorecardLinks,
) => {
  const sc = {
    loyalty: metric(null),
    attendance: metric(null),
    netWorth: metric(null),
    connectedContracts: metric(null),
    ...v,
  };
  scorecardHook.mockReturnValue({
    scorecard: {
      ...sc,
      hasAny: Object.values(sc).some(
        (m) => (m as ScorecardMetric)?.value != null,
      ),
    },
    isLoading: false,
    maxMetrics: 4,
  });
  return render(
    <MpScorecardTile name="Сергей Дмитриевич Станишев" links={links} />,
  );
};

const cls = (r: RenderResult): string =>
  r.container.querySelector(".grid")?.className ?? "";

beforeEach(() => scorecardHook.mockReset());

describe("MpScorecardTile", () => {
  it("renders four metrics for a sitting MP with full coverage", () => {
    show({
      loyalty: metric(0.94),
      attendance: metric(0.81),
      netWorth: metric(953283),
      connectedContracts: metric(120000),
    });
    for (const k of [
      "mp_scorecard_loyalty",
      "mp_scorecard_attendance",
      "mp_scorecard_net_worth",
      "mp_scorecard_connected_contracts",
    ])
      expect(screen.getByText(k)).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("drops the roll-call metrics entirely for a pre-2020 MP", () => {
    // Станишев's case: only declared net worth resolves. The two roll-call labels must be
    // ABSENT, not present-with-a-dash — the tile should never imply we measured something
    // the corpus cannot contain.
    show({ netWorth: metric(953283) });
    expect(screen.getByText("mp_scorecard_net_worth")).toBeInTheDocument();
    expect(screen.queryByText("mp_scorecard_loyalty")).not.toBeInTheDocument();
    expect(
      screen.queryByText("mp_scorecard_attendance"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("mp_scorecard_connected_contracts"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("sizes the grid to the surviving metrics", () => {
    // A lone metric under the old fixed `grid-cols-2` sat in a half-width card beside an
    // empty cell.
    const one = show({ netWorth: metric(1) });
    expect(cls(one)).toContain("grid-cols-1");
    one.unmount();

    // Two stays two-up at EVERY width — asserting only `toContain("grid-cols-2")` would be
    // satisfied by the 3 and 4 entries too (both begin with it) and by the old fixed class
    // string, so it would distinguish nothing about the count.
    const two = show({ netWorth: metric(1), loyalty: metric(0.5) });
    expect(cls(two)).toContain("grid-cols-2");
    expect(cls(two)).not.toContain("sm:grid-cols");
    two.unmount();

    // Three is the only entry whose two classes differ from every other row, so it is the
    // one most likely to be typo'd, and it was the one never rendered.
    const three = show({
      netWorth: metric(1),
      loyalty: metric(0.5),
      connectedContracts: metric(0),
    });
    expect(cls(three)).toContain("sm:grid-cols-3");
    three.unmount();

    const four = show({
      loyalty: metric(0.9),
      attendance: metric(0.8),
      netWorth: metric(1),
      connectedContracts: metric(2),
    });
    expect(cls(four)).toContain("sm:grid-cols-4");
  });

  it("has a complete column class for every renderable metric count", () => {
    // The metric list is the domain. Add a fifth metric without extending GRID_COLS and the
    // lookup returns undefined — `className="grid gap-3 undefined"`, a valid one-column grid
    // with no error and no failing render. `gridCols` clamps, so this asserts the shape of
    // every entry rather than relying on the clamp to hide a gap.
    for (let n = 1; n <= 4; n += 1)
      expect(GRID_COLS[n as keyof typeof GRID_COLS]).toMatch(
        /^grid-cols-\d( sm:grid-cols-\d)?$/,
      );
    // Out-of-domain counts clamp rather than yielding `undefined`.
    expect(gridCols(0)).toBe(GRID_COLS[1]);
    expect(gridCols(9)).toBe(GRID_COLS[4]);
  });

  it("renders nothing at all when no metric resolves", () => {
    const { container } = show({});
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps a metric whose value is legitimately zero", () => {
    // The filter tests `!= null`, so a literal 0 survives — a truthiness filter (or a `> 0`)
    // would delete exactly this row, and an MP whose connected firms won nothing is a real
    // finding. Asserting the rendered VALUE, not just the label, is what pins the formatter
    // too: a formatter that dashed on falsy would pass a label-only check.
    //
    // NB this guards the PREDICATE, not yet the live path: mp_scorecard() (034) returns NULL
    // rather than 0 for an MP whose linked firms won nothing — `me` reads an aggregate those
    // MPs are absent from — so the €0 case cannot currently arrive. See useMpScorecard's
    // connected-contracts comment.
    show({ connectedContracts: metric(0) });
    expect(
      screen.getByText("mp_scorecard_connected_contracts"),
    ).toBeInTheDocument();
    expect(screen.getByText("€0")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("tints attendance amber only when it is well below the cohort median", () => {
    show({
      attendance: metric(0.4, { rank: 200, cohortSize: 240, median: 0.9 }),
    });
    expect(screen.getByText("40%")).toHaveClass("text-amber-600");
  });

  it("leaves attendance untinted at the median", () => {
    show({
      attendance: metric(0.9, { rank: 120, cohortSize: 240, median: 0.9 }),
    });
    expect(screen.getByText("90%")).not.toHaveClass("text-amber-600");
  });

  it("emits no anchor for a metric that was filtered out", () => {
    // PersonMpSections passes `links.netWorth` and `links.loyalty` unconditionally, relying
    // on the metric's ABSENCE to suppress the anchor — the explicit
    // `value != null ? links?.x : undefined` guards were removed as redundant, so this is
    // the only thing holding that contract.
    show(
      { netWorth: metric(953283) },
      { loyalty: "#parliament", netWorth: "#declarations" },
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "#declarations");
  });
});
