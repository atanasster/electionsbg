import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMapDrillDown } from "./useMapDrillDown";

const setReducedMotion = (reduce: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"),
  })) as unknown as typeof window.matchMedia;
};

/** A fake Web Animation whose `cancel()` fires its listeners, as the real one does. */
const fakeAnimation = () => {
  const listeners: (() => void)[] = [];
  return {
    cancelled: false,
    addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    cancel() {
      this.cancelled = true;
      listeners.splice(0).forEach((cb) => cb());
    },
  };
};

/** frame > box > (svg, path). jsdom implements no SVG geometry, so the path is a stand-in. */
const buildMap = (withAnimate = true) => {
  const frame = document.createElement("div");
  const box = document.createElement("div");
  frame.appendChild(box);
  const anims: ReturnType<typeof fakeAnimation>[] = [];
  if (withAnimate)
    box.animate = vi.fn(() => {
      const a = fakeAnimation();
      anims.push(a);
      return a as unknown as Animation;
    });
  else (box as { animate?: unknown }).animate = undefined;
  const svg = {
    parentElement: box,
    width: { baseVal: { value: 800 } },
    height: { baseVal: { value: 600 } },
  };
  const path = {
    ownerSVGElement: svg,
    getBBox: () => ({ x: 100, y: 100, width: 50, height: 50 }),
  } as unknown as SVGGraphicsElement;
  return { frame, box, path, anims };
};

const renderDrill = () =>
  renderHook(() => ({ drill: useMapDrillDown(), navigate: useNavigate() }), {
    wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
  });

describe("useMapDrillDown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flies into the region and navigates at 80% of the flight", () => {
    setReducedMotion(false);
    const { result } = renderDrill();
    const { frame, box, path, anims } = buildMap();
    const go = vi.fn();
    act(() => result.current.drill(path, go));
    expect(anims).toHaveLength(1);
    expect(frame.style.overflow).toBe("hidden");
    expect(box.style.transformOrigin).toBe("0 0");
    vi.advanceTimersByTime(383);
    expect(go).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(go).toHaveBeenCalledOnce();
  });

  it("ignores a second call while a flight is under way — no double navigation", () => {
    setReducedMotion(false);
    const { result } = renderDrill();
    const { path, anims } = buildMap();
    const go = vi.fn();
    act(() => {
      result.current.drill(path, go);
      result.current.drill(path, go);
    });
    vi.runAllTimers();
    expect(anims).toHaveLength(1);
    expect(go).toHaveBeenCalledOnce();
  });

  it("cancels the zoom on the next route, restoring what the flight changed", () => {
    setReducedMotion(false);
    const { result } = renderDrill();
    const { frame, box, path, anims } = buildMap();
    frame.style.overflow = "visible";
    act(() => result.current.drill(path, vi.fn()));
    act(() => result.current.navigate("/municipality/VAR"));
    expect(anims[0].cancelled).toBe(true);
    expect(frame.style.overflow).toBe("visible");
    expect(box.style.transformOrigin).toBe("");
  });

  it("cancels the zoom on unmount, and a cancelled flight never navigates", () => {
    setReducedMotion(false);
    const { result, unmount } = renderDrill();
    const { path, anims } = buildMap();
    const go = vi.fn();
    act(() => result.current.drill(path, go));
    unmount();
    expect(anims[0].cancelled).toBe(true);
    vi.runAllTimers();
    expect(go).not.toHaveBeenCalled();
  });

  it("navigates at once under reduced motion and without the Web Animations API", () => {
    const { result } = renderDrill();

    setReducedMotion(true);
    const a = buildMap();
    const go1 = vi.fn();
    result.current.drill(a.path, go1);
    expect(go1).toHaveBeenCalledOnce();
    expect(a.anims).toHaveLength(0);

    setReducedMotion(false);
    const b = buildMap(false);
    const go2 = vi.fn();
    result.current.drill(b.path, go2);
    expect(go2).toHaveBeenCalledOnce();
  });
});
