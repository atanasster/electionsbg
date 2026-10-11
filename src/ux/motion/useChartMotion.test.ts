import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useChartMotion } from "./useChartMotion";

const setReducedMotion = (reduce: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

/** Render the hook with `series` drawn under `k`; returns each series' isAnimationActive. */
const harness = (initial: { k: number; series: string[] }) =>
  renderHook(
    ({ k, series }) => {
      const motion = useChartMotion(k);
      return Object.fromEntries(
        series.map((id) => [id, motion(id).isAnimationActive]),
      );
    },
    { initialProps: initial },
  );

describe("useChartMotion", () => {
  it("is off on mount and on re-renders of the same state", () => {
    setReducedMotion(false);
    const { result, rerender } = harness({ k: 2024, series: ["BG"] });
    expect(result.current.BG).toBe(false);
    rerender({ k: 2024, series: ["BG"] });
    expect(result.current.BG).toBe(false);
  });

  it("turns on in the very render the state changes, and stays on — even back to the first", () => {
    setReducedMotion(false);
    const { result, rerender } = harness({ k: 2024, series: ["BG"] });
    rerender({ k: 2022, series: ["BG"] });
    expect(result.current.BG).toBe(true);
    rerender({ k: 2024, series: ["BG"] });
    expect(result.current.BG).toBe(true);
  });

  it("never animates a series that first appears after the change — that is its mount", () => {
    setReducedMotion(false);
    const { result, rerender } = harness({ k: 2024, series: ["BG"] });
    rerender({ k: 2022, series: ["BG"] });
    rerender({ k: 2022, series: ["BG", "RO"] });
    expect(result.current).toEqual({ BG: true, RO: false });
    rerender({ k: 2020, series: ["BG", "RO"] });
    expect(result.current).toEqual({ BG: true, RO: true });
  });

  it("treats a series that left and came back as a fresh mount", () => {
    setReducedMotion(false);
    const { result, rerender } = harness({ k: 2024, series: ["BG", "RO"] });
    rerender({ k: 2022, series: ["BG", "RO"] });
    rerender({ k: 2022, series: ["BG"] }); // RO removed — e.g. a loading skeleton
    rerender({ k: 2020, series: ["BG", "RO"] });
    expect(result.current).toEqual({ BG: true, RO: false });
  });

  it("stays off under prefers-reduced-motion", () => {
    setReducedMotion(true);
    const { result, rerender } = harness({ k: 2024, series: ["BG"] });
    rerender({ k: 2022, series: ["BG"] });
    expect(result.current.BG).toBe(false);
  });
});
