import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimatedText } from "./AnimatedText";

const setReducedMotion = (reduce: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

describe("AnimatedText", () => {
  let frameCbs: FrameRequestCallback[] = [];
  let now = 0;

  beforeEach(() => {
    frameCbs = [];
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frameCbs.push(cb);
      return frameCbs.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const advance = (ms: number) => {
    now += ms;
    const cbs = frameCbs;
    frameCbs = [];
    act(() => cbs.forEach((cb) => cb(now)));
  };

  it("renders the value verbatim on first paint — no count-up on load", () => {
    setReducedMotion(false);
    render(<AnimatedText value="€3,3 млрд." />);
    expect(screen.getByText("€3,3 млрд.")).toBeTruthy();
    expect(frameCbs).toHaveLength(0);
  });

  it("rolls through intermediate frames and settles on the exact target", () => {
    setReducedMotion(false);
    const { rerender, container } = render(<AnimatedText value="€3,3 млрд." />);
    rerender(<AnimatedText value="€12,1 млрд." />);
    advance(100);
    const mid = container.textContent!;
    expect(mid).not.toBe("€3,3 млрд.");
    expect(mid).not.toBe("€12,1 млрд.");
    expect(mid).toMatch(/^€\d+,\d млрд\.$/);
    advance(1000);
    expect(container.textContent).toBe("€12,1 млрд.");
  });

  it("snaps under prefers-reduced-motion", () => {
    setReducedMotion(true);
    const { rerender, container } = render(<AnimatedText value="10%" />);
    rerender(<AnimatedText value="20%" />);
    expect(container.textContent).toBe("20%");
    expect(frameCbs).toHaveLength(0);
  });

  it("snaps when the figures are not tweenable (a unit change)", () => {
    setReducedMotion(false);
    const { rerender, container } = render(<AnimatedText value="€930 млн." />);
    rerender(<AnimatedText value="€1,2 млрд." />);
    expect(container.textContent).toBe("€1,2 млрд.");
  });

  it("continues a mid-roll change from the frame on screen, not the old target", () => {
    setReducedMotion(false);
    const { rerender, container } = render(<AnimatedText value="€3,3 млрд." />);
    rerender(<AnimatedText value="€12,1 млрд." />);
    advance(100);
    const visible = Number(
      container.textContent!.match(/[\d,]+/)![0].replace(",", "."),
    );
    rerender(<AnimatedText value="€20,0 млрд." />);
    advance(16);
    const next = Number(
      container.textContent!.match(/[\d,]+/)![0].replace(",", "."),
    );
    expect(next).toBeGreaterThanOrEqual(visible);
    expect(next).toBeLessThan(20);
  });
});
