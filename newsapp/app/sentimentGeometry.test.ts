import { describe, it, expect } from "vitest";
import { EXTENT, clampUnit, markerTop, whiskerFor } from "./sentimentGeometry";

describe("markerTop", () => {
  it("puts the extremes at the rails and zero in the middle", () => {
    expect(markerTop(0)).toBe(50);
    expect(markerTop(EXTENT)).toBe(0);
    expect(markerTop(-EXTENT)).toBe(100);
  });

  it("is linear in between", () => {
    expect(markerTop(1)).toBe(25);
    expect(markerTop(-1)).toBe(75);
  });

  it("clamps a value past the scale rather than drawing off the row", () => {
    expect(markerTop(9)).toBe(0);
    expect(markerTop(-9)).toBe(100);
  });
});

describe("whiskerFor", () => {
  it("brackets the mean by exactly one standard error", () => {
    // mean -1.5, se 0.2 -> the interval is [-1.7, -1.3] on a ±2 scale, i.e.
    // normalized [-0.85, -0.65] -> 82.5% from the top, 7.5% from the bottom.
    const w = whiskerFor(-1.5, 0.2);
    expect(w.top).toBeCloseTo(82.5, 6);
    expect(w.bottom).toBeCloseTo(7.5, 6);
    expect(w.clippedHigh).toBe(false);
    expect(w.clippedLow).toBe(false);
  });

  it("is symmetric about the mean", () => {
    const up = whiskerFor(1.0, 0.4);
    const down = whiskerFor(-1.0, 0.4);
    expect(up.top).toBeCloseTo(down.bottom, 9);
    expect(up.bottom).toBeCloseTo(down.top, 9);
  });

  it("reports a clipped end rather than silently narrowing the claim", () => {
    // ⚠️ A clamped whisker turns "±0.3 around +2.0" into a one-sided
    // interval with nothing to show it was cut.
    const w = whiskerFor(2, 0.3);
    expect(w.clippedHigh).toBe(true);
    expect(w.clippedLow).toBe(false);
    expect(w.top).toBe(0);
  });

  it("reports a whisker wider than the whole scale", () => {
    // ⚠️ A full-height bar is indistinguishable from a genuine full-scale
    // spread unless it says it was cut. Two articles at opposite ends give a
    // standard error of exactly 2, which REACHES the rails without passing
    // them — so that case is honestly not clipped, and the boundary is
    // asserted alongside the case that is.
    const exact = whiskerFor(0, 2);
    expect(exact.clippedHigh).toBe(false);
    expect(exact.clippedLow).toBe(false);
    expect(exact.top).toBe(0);
    expect(exact.bottom).toBe(0);

    const beyond = whiskerFor(0, 2.5);
    expect(beyond.clippedHigh).toBe(true);
    expect(beyond.clippedLow).toBe(true);
  });

  it("treats a zero standard error as a real answer, not a missing one", () => {
    // ⚠️ The producer emits `None` only at n = 1; at n >= 2 with no variance
    // it emits 0.0, and a "greater than zero" test would report a unanimous
    // five-article period as a single article.
    const w = whiskerFor(1, 0);
    expect(w.top + w.bottom).toBeCloseTo(100, 9);
    expect(w.clippedHigh).toBe(false);
    expect(w.clippedLow).toBe(false);
  });

  it("never returns an offset outside the row", () => {
    for (const mean of [-3, -2, -0.5, 0, 0.5, 2, 3]) {
      for (const se of [0, 0.1, 1, 5]) {
        const w = whiskerFor(mean, se);
        expect(w.top).toBeGreaterThanOrEqual(0);
        expect(w.bottom).toBeGreaterThanOrEqual(0);
        expect(w.top + w.bottom).toBeLessThanOrEqual(100.000001);
      }
    }
  });
});

describe("clampUnit", () => {
  it("bounds to [-1, 1]", () => {
    expect(clampUnit(5)).toBe(1);
    expect(clampUnit(-5)).toBe(-1);
    expect(clampUnit(0.5)).toBe(0.5);
  });
});
