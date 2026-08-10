import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type { MacroPayload, MacroPoint } from "@/data/macro/useMacro";
import {
  computePayVsProductivityCallout,
  INDEX_BASE_YEAR,
} from "./payVsProductivity";

const pts = (v: Record<number, number>): MacroPoint[] =>
  Object.entries(v).map(([year, value]) => ({ year: +year, value }));

const payload = (s: Partial<Record<string, MacroPoint[]>>) =>
  ({ series: s }) as unknown as MacroPayload;

// One decimal, dot separator — enough to assert on without a locale.
const fmt = (v: number) => v.toFixed(1);

describe("computePayVsProductivityCallout", () => {
  it("reproduces the 2015→2025 Bulgarian figures", () => {
    const out = computePayVsProductivityCallout(
      payload({
        compensationPerEmployee: pts({ 2015: 7381.5, 2025: 19681.6 }),
        priceIndex: pts({ 2015: 100, 2025: 142.5 }),
        labourProductivity: pts({ 2015: 100, 2025: 126.97 }),
      }),
      fmt,
    );
    expect(out).toEqual({
      from: 2015,
      to: 2025,
      nominalPay: "166.6",
      prices: "42.5",
      realPay: "87.1",
      productivity: "27.0",
      multiple: "3.2",
    });
  });

  it("deflates with the price INDEX, not a chain of YoY rates", () => {
    // Same window, price level flat: real pay must equal nominal pay.
    const out = computePayVsProductivityCallout(
      payload({
        compensationPerEmployee: pts({ 2015: 100, 2025: 200 }),
        priceIndex: pts({ 2015: 100, 2025: 100 }),
        labourProductivity: pts({ 2015: 100, 2025: 150 }),
      }),
      fmt,
    );
    expect(out?.realPay).toBe("100.0");
    expect(out?.nominalPay).toBe("100.0");
    expect(out?.multiple).toBe("2.0");
  });

  it("clips the end of the window to the overlap of all three series", () => {
    // Pay runs a year ahead. Comparing its 2026 value against productivity's
    // 2025 would overstate the pay side by a full year of growth.
    const out = computePayVsProductivityCallout(
      payload({
        compensationPerEmployee: pts({ 2015: 100, 2025: 200, 2026: 260 }),
        priceIndex: pts({ 2015: 100, 2025: 100, 2026: 100 }),
        labourProductivity: pts({ 2015: 100, 2025: 150 }),
      }),
      fmt,
    );
    expect(out?.to).toBe(2025);
    expect(out?.nominalPay).toBe("100.0");
  });

  it("starts at the 2015 index base, not the earliest year available", () => {
    // The chart above this caption is indexed to 2015 = 100. Measuring from
    // 2005 would contradict it — and would report a far more extreme ratio
    // that is mostly EU-accession convergence.
    const out = computePayVsProductivityCallout(
      payload({
        compensationPerEmployee: pts({ 2005: 25, 2015: 100, 2025: 200 }),
        priceIndex: pts({ 2005: 50, 2015: 100, 2025: 100 }),
        labourProductivity: pts({ 2005: 60, 2015: 100, 2025: 150 }),
      }),
      fmt,
    );
    expect(out?.from).toBe(2015);
    expect(out?.nominalPay).toBe("100.0");
    expect(out?.productivity).toBe("50.0");
  });

  it("falls back to the earliest common year when 2015 is missing", () => {
    const out = computePayVsProductivityCallout(
      payload({
        compensationPerEmployee: pts({ 2016: 100, 2025: 200 }),
        priceIndex: pts({ 2016: 100, 2025: 100 }),
        labourProductivity: pts({ 2016: 100, 2025: 150 }),
      }),
      fmt,
    );
    expect(out?.from).toBe(2016);
    expect(out?.to).toBe(2025);
  });

  it("falls back rather than collapsing a window that ENDS at the base year", () => {
    // Pinning `from` to 2015 here would make from === to and drop the callout
    // entirely, even though [2014, 2015] is a usable window.
    const out = computePayVsProductivityCallout(
      payload({
        compensationPerEmployee: pts({ 2014: 100, 2015: 150 }),
        priceIndex: pts({ 2014: 100, 2015: 100 }),
        labourProductivity: pts({ 2014: 100, 2015: 110 }),
      }),
      fmt,
    );
    expect(out?.from).toBe(2014);
    expect(out?.to).toBe(2015);
    expect(out?.realPay).toBe("50.0");
  });

  it("suppresses the multiple when real pay fell", () => {
    // Prices outran pay. "Real pay grew roughly -0.4x faster than
    // productivity" is a false claim with a number attached — pay fell. The
    // two percentage figures in the sentence still tell the story.
    const out = computePayVsProductivityCallout(
      payload({
        compensationPerEmployee: pts({ 2015: 100, 2025: 120 }),
        priceIndex: pts({ 2015: 100, 2025: 150 }),
        labourProductivity: pts({ 2015: 100, 2025: 150 }),
      }),
      fmt,
    );
    expect(out?.realPay).toBe("-20.0");
    expect(out?.productivity).toBe("50.0");
    expect(out?.multiple).toBeNull();
  });

  it("suppresses the multiple when productivity barely moved", () => {
    // prodG = 1.001 clears a bare `prodG > 1` and renders "1000x" off what is
    // effectively a rounding difference.
    const out = computePayVsProductivityCallout(
      payload({
        compensationPerEmployee: pts({ 2015: 100, 2025: 200 }),
        priceIndex: pts({ 2015: 100, 2025: 100 }),
        labourProductivity: pts({ 2015: 100, 2025: 100.1 }),
      }),
      fmt,
    );
    expect(out?.multiple).toBeNull();
    // Still reports both sides — only the ratio is withheld.
    expect(out?.realPay).toBe("100.0");
    expect(out?.productivity).toBe("0.1");
  });

  it("keeps the multiple at the growth floor", () => {
    // Guards the boundary in the other direction: exactly +1.0pp of
    // productivity growth is enough, so the floor cannot silently drift up
    // and start suppressing legitimate windows.
    const out = computePayVsProductivityCallout(
      payload({
        compensationPerEmployee: pts({ 2015: 100, 2025: 110 }),
        priceIndex: pts({ 2015: 100, 2025: 100 }),
        labourProductivity: pts({ 2015: 100, 2025: 101 }),
      }),
      fmt,
    );
    expect(out?.multiple).toBe("10.0");
  });

  it("suppresses the multiple when productivity did not grow", () => {
    // A ratio against a flat or shrinking denominator is infinite or negative;
    // both render as nonsense, so the caption must be able to drop it.
    const flat = computePayVsProductivityCallout(
      payload({
        compensationPerEmployee: pts({ 2015: 100, 2025: 200 }),
        priceIndex: pts({ 2015: 100, 2025: 100 }),
        labourProductivity: pts({ 2015: 100, 2025: 100 }),
      }),
      fmt,
    );
    expect(flat?.multiple).toBeNull();

    const shrinking = computePayVsProductivityCallout(
      payload({
        compensationPerEmployee: pts({ 2015: 100, 2025: 200 }),
        priceIndex: pts({ 2015: 100, 2025: 100 }),
        labourProductivity: pts({ 2015: 100, 2025: 90 }),
      }),
      fmt,
    );
    expect(shrinking?.multiple).toBeNull();
    expect(shrinking?.productivity).toBe("-10.0");
  });

  it("returns null when any of the three series is absent or too short", () => {
    const base = {
      compensationPerEmployee: pts({ 2015: 100, 2025: 200 }),
      priceIndex: pts({ 2015: 100, 2025: 100 }),
      labourProductivity: pts({ 2015: 100, 2025: 150 }),
    };
    expect(computePayVsProductivityCallout(undefined, fmt)).toBeNull();
    expect(
      computePayVsProductivityCallout(
        payload({ ...base, labourProductivity: [] }),
        fmt,
      ),
    ).toBeNull();
    // Present but with no overlapping years — one point of overlap is not a window.
    expect(
      computePayVsProductivityCallout(
        payload({ ...base, priceIndex: pts({ 2015: 100 }) }),
        fmt,
      ),
    ).toBeNull();
  });
});

describe("INDEX_BASE_YEAR vs the committed artifact", () => {
  // The JSDoc on INDEX_BASE_YEAR warns that changing it without changing the
  // fetched `unit` silently reframes the caption against a base the chart does
  // not use. This is the gate behind that warning: an upstream I15 → I20
  // rebase, or an edit to either side alone, fails here rather than shipping a
  // caption measured from a base nothing else uses.
  const macro = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../../../data/macro.json"),
      "utf8",
    ),
  ) as MacroPayload;

  const INDEXED = [
    "labourProductivity",
    "unitLabourCost",
    "priceIndex",
  ] as const;

  it.each(INDEXED)("%s is indexed to INDEX_BASE_YEAR", (key) => {
    const meta = macro.indicators[key];
    expect(meta, `${key} missing from macro.json`).toBeTruthy();
    expect(meta.unitLabelEn).toContain(`${INDEX_BASE_YEAR} = 100`);

    const base = macro.series[key].find((p) => p.year === INDEX_BASE_YEAR);
    expect(base, `${key} has no ${INDEX_BASE_YEAR} point`).toBeTruthy();
    expect(base!.value).toBeCloseTo(100, 1);
  });

  it("compensationPerEmployee is a LEVEL, not an index", () => {
    // The asymmetry is deliberate and load-bearing: Eurostat publishes no
    // index form of D1_SAL_PER, which is why it cannot share the chart axis
    // and why the caption deflates it by priceIndex instead. If it ever
    // arrives as an index, the callout's arithmetic needs revisiting.
    const meta = macro.indicators.compensationPerEmployee;
    expect(meta.unitLabelEn).not.toContain("= 100");
    const base = macro.series.compensationPerEmployee.find(
      (p) => p.year === INDEX_BASE_YEAR,
    );
    expect(base!.value).toBeGreaterThan(1000);
  });
});
