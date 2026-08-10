import { describe, expect, it } from "vitest";
import type { MacroPayload, MacroPoint } from "@/data/macro/useMacro";
import { computePayVsProductivityCallout } from "./payVsProductivity";

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
