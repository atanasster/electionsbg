// The hollow dot is not styling. It is how the page distinguishes a value the corpus
// OBSERVED from one a coalition or an older name LENT (rules 4 and 5), and a dot-renderer
// change would erase that distinction silently — the line would still be drawn, every
// number would still be right, and an editorial join would start reading as a plain series.

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { PairSeries } from "@/data/parliament/votes/partyPairs";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "bg" },
  }),
}));

// recharts' ResponsiveContainer measures its parent, which jsdom reports as 0×0 — the chart
// would mount and draw nothing, and every assertion below would pass vacuously. Same
// workaround as PersonWealthTrajectory.test.tsx, but the size is handed to the CHART rather
// than to a wrapping div, because these assertions need real plotted geometry.
type Sized = { width?: number; height?: number };
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  const { cloneElement } = await import("react");
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: React.ReactElement<Sized>;
    }) => cloneElement(children, { width: 800, height: 260 }),
  };
});

const { PairCorrelationArcChart } = await import("./PairCorrelationArcChart");

const pair: PairSeries = {
  id: "ГЕРБ-СДС|ПП",
  a: "ГЕРБ-СДС",
  b: "ПП",
  aRaw: "ГЕРБ - СДС",
  bRaw: "ПП",
  points: [
    { ns: "48", score: 0.27 },
    { ns: "49", score: 0.1, via: "ПП - ДБ" },
  ],
};

const dotsOf = (container: HTMLElement) => [
  ...container.querySelectorAll(".recharts-line-dots circle"),
];

describe("PairCorrelationArcChart", () => {
  it("draws a lent point hollow and an observed point filled", () => {
    const { container } = render(
      <PairCorrelationArcChart
        pair={pair}
        parliaments={["48", "49", "52"]}
        currentNs="52"
      />,
    );
    const dots = dotsOf(container);
    // Two points, not three: the 52nd is a gap and must not get a dot floating over it.
    expect(dots).toHaveLength(2);
    const hollow = dots.filter((d) =>
      d.getAttribute("fill")?.includes("--card"),
    );
    const filled = dots.filter((d) =>
      d.getAttribute("fill")?.includes("--primary"),
    );
    expect(hollow).toHaveLength(1);
    expect(filled).toHaveLength(1);
  });

  it("draws every point filled when nothing was lent", () => {
    const { container } = render(
      <PairCorrelationArcChart
        pair={{
          ...pair,
          points: [
            { ns: "48", score: 0.27 },
            { ns: "49", score: 0.1 },
          ],
        }}
        parliaments={["48", "49", "52"]}
        currentNs="52"
      />,
    );
    // Proves the hollow assertion above discriminates rather than passing on every input.
    expect(
      dotsOf(container).filter((d) =>
        d.getAttribute("fill")?.includes("--card"),
      ),
    ).toHaveLength(0);
  });

  it("renders nothing for a pair with no points", () => {
    const { container } = render(
      <PairCorrelationArcChart
        pair={{ ...pair, points: [] }}
        parliaments={["48", "49"]}
        currentNs="49"
      />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});
