// Gates for the COFOG bar chart's presentation layer (plan T9.1).
//
// Recharts renders nothing at width 0 and the headless environment reports
// exactly that, so the bars themselves are unobservable here. What IS testable
// is everything around them — and that is where this component's two real
// defects were: a Y axis too narrow for the labels it had to name, and axis text
// that was not theme-aware.
//
// The DATA properties (nothing collapses, ranked by share, a null share is
// dropped) live in `budgetFunctionalBars.test.ts`, which is why this file does
// not restate them.

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import bgDict from "@/locales/bg/translation.json";
import { BudgetFunctionalChart } from "./BudgetFunctionalChart";
import { truncateTick, type FunctionalBar } from "./budgetFunctionalBars";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => (bgDict as Record<string, string>)[k] ?? k,
  }),
}));

const dict = bgDict as Record<string, string>;

/** Two bars, since nothing here depends on the count. The LABELS are the real
 *  bundle strings — an earlier fixture used shortened ones („Жилищно
 *  строителство"), which is precisely why the axis clipping the real 38-char
 *  „Жилищно строителство и благоустройство" went unnoticed. */
const BARS: FunctionalBar[] = [
  {
    code: "GF10",
    label: dict.cofog_GF10,
    pct: 36.8,
    amountLabel: "€15 091 900 000",
  },
  {
    code: "GF06",
    label: dict.cofog_GF06,
    pct: 2.6,
    amountLabel: "€1 070 000 000",
  },
];

describe("truncateTick", () => {
  it("shortens a label the axis cannot hold, and marks that it did", () => {
    // ⚠️ THE SHIPPED DEFECT. „Жилищно строителство и благоустройство" is 38
    // characters — about 205px at 11px against a 150px axis — and Recharts
    // neither wraps nor ellipsises a category tick: the text runs to a negative
    // x and the SVG clips it, so a third of the name vanished with nothing to
    // show it had. GF06 is also one of the three small functions the whole
    // „bar, not donut" argument is built on.
    expect(dict.cofog_GF06.length).toBeGreaterThan(24);
    const out = truncateTick(dict.cofog_GF06);
    expect(out.length).toBeLessThanOrEqual(24);
    expect(out.endsWith("…")).toBe(true);
    // …and it is a PREFIX of the real name, not an arbitrary slice.
    expect(dict.cofog_GF06.startsWith(out.slice(0, -1))).toBe(true);
  });

  it("leaves a label that fits completely alone", () => {
    expect(truncateTick(dict.cofog_GF07)).toBe(dict.cofog_GF07);
    expect(truncateTick(dict.cofog_GF10)).toBe(dict.cofog_GF10);
  });

  it("holds for EVERY label the page can render, in both bundles", () => {
    // The axis is fixed-width, so the guarantee has to be over the whole label
    // set rather than over the two in the fixture.
    for (const [k, v] of Object.entries(dict)) {
      if (!k.startsWith("cofog_GF")) continue;
      expect(truncateTick(v).length, `${k} overflows`).toBeLessThanOrEqual(24);
    }
  });
});

describe("BudgetFunctionalChart", () => {
  it("renders nothing at all when there is nothing to draw", () => {
    // An empty framed box under a heading reads as „nothing was spent on
    // anything", which is the misreading this page's header warns about for a
    // year COFOG does not cover.
    const { container } = render(<BudgetFunctionalChart bars={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("names itself, so the picture is not unlabelled", () => {
    const { container } = render(<BudgetFunctionalChart bars={BARS} />);
    expect(container.querySelector("figcaption")?.textContent).toBe(
      dict.budget_func_chart_h,
    );
  });

  it("hides the plot from the accessibility tree — but not its caption", () => {
    // The ranked <ul> stays directly beneath with every label, figure and
    // share. A second copy would make a screen reader read all ten functions
    // twice, and it doubled every findByText on the page, which is how the
    // first cut's `sr-only` table was caught.
    const { container } = render(<BudgetFunctionalChart bars={BARS} />);
    const plot = container.querySelector("[aria-hidden]") as HTMLElement;
    // `aria-hidden="false"` would satisfy a mere presence check.
    expect(plot?.getAttribute("aria-hidden")).toBe("true");
    // The caption is OUTSIDE it, or the chart has no accessible name at all.
    expect(plot?.querySelector("figcaption")).toBeNull();
  });

  it("grows with the row count instead of squeezing ten rows into a fixed box", () => {
    const h = (bars: FunctionalBar[]) => {
      const { container } = render(<BudgetFunctionalChart bars={bars} />);
      const box = container.querySelector("[aria-hidden]") as HTMLElement;
      // No `?? 0` fallback: a selector that stops matching must fail loudly
      // rather than compare two zeroes and pass.
      expect(box, "no sized plot box").not.toBeNull();
      return Number(box.style.height.replace("px", ""));
    };
    const ten = h(
      Array.from({ length: 10 }, (_, i) => ({ ...BARS[0], code: `X${i}` })),
    );
    expect(ten).toBeGreaterThan(h(BARS));
    expect(ten).toBe(300);
  });
});
