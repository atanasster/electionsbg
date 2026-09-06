// The five conditions that decide whether `/` makes a third request and mounts a canvas.
//
// ⚠️ THIS IS THE FILE THAT MEASURES THE REDUCED-MOTION GUARANTEE. `HomeFlyover.test.tsx` mocks
// this hook, so a reduced-motion assertion there is made against a stub triple the real hook
// cannot return — it passes whether or not the production gate exists. The gate is here.

import { createElement } from "react";
import { render, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_FALLBACK_MS, useArm, type ArmState } from "./useArm";

/**
 * A probe that ATTACHES the ref.
 *
 * ⚠️ `renderHook` cannot be used here: `useInView` returns early when `ref.current` is null,
 * so the hook would never observe anything and every assertion below would read „not armed"
 * for the wrong reason — the shape of a test that passes while measuring nothing.
 */
const latest: { state: ArmState | null } = { state: null };
const Probe = () => {
  const state = useArm();
  latest.state = state;
  return createElement("div", { ref: state.ref });
};

const mount = (): { current: ArmState } => {
  render(createElement(Probe));
  return {
    get current() {
      return latest.state!;
    },
  };
};

const observers: { cb: IntersectionObserverCallback }[] = [];

const stubIntersection = () => {
  observers.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: IntersectionObserverCallback) {
        observers.push({ cb });
      }
      observe() {}
      disconnect() {}
    },
  );
};

const intersect = () => {
  act(() => {
    for (const o of observers) {
      o.cb(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    }
  });
};

const stubMedia = (matches: boolean) =>
  vi.stubGlobal("matchMedia", () => ({ matches }) as MediaQueryList);

const stubSaveData = (saveData: boolean | undefined) => {
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value: saveData === undefined ? undefined : { saveData },
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  stubIntersection();
  stubMedia(false);
  stubSaveData(undefined);
  // No `requestIdleCallback` in jsdom, which is also the Safari case — the fallback timer is
  // therefore the path every one of these tests exercises. That is deliberate: it is the only
  // way the band ever arms in Safari, and it had no coverage at all.
});

afterEach(() => {
  cleanup();
  latest.state = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settleIdle = () => {
  act(() => {
    vi.advanceTimersByTime(IDLE_FALLBACK_MS + 1);
  });
};

describe("useArm", () => {
  it("arms once in view, idle, visible, motion allowed and data not saved", () => {
    const result = mount();
    expect(result.current.armed).toBe(false);
    intersect();
    expect(result.current.armed, "idle has not fired yet").toBe(false);
    settleIdle();
    expect(result.current.armed).toBe(true);
    expect(result.current.running).toBe(true);
  });

  it("NEVER arms under prefers-reduced-motion, whatever else holds", () => {
    // Plan §2.9. This is what makes „no requestAnimationFrame" true in production: no arming,
    // no canvas, no loop — rather than a loop that chooses not to run.
    stubMedia(true);
    const result = mount();
    intersect();
    settleIdle();
    expect(result.current.armed).toBe(false);
    expect(result.current.running).toBe(false);
    expect(result.current.reducedMotion).toBe(true);
  });

  it("never arms under Save-Data", () => {
    stubSaveData(true);
    const result = mount();
    intersect();
    settleIdle();
    expect(result.current.armed).toBe(false);
  });

  it("treats a browser that cannot tell us as NO OBJECTION, not as refusal", () => {
    // `navigator.connection` is absent in every Safari and Firefox, and `matchMedia` can be
    // absent or throw. The poster is already the fallback, so an unavailable signal must not
    // cost every one of those readers the scene.
    vi.stubGlobal("matchMedia", undefined);
    stubSaveData(undefined);
    const result = mount();
    intersect();
    settleIdle();
    expect(result.current.armed).toBe(true);
    expect(result.current.reducedMotion).toBe(false);
  });

  it("survives a matchMedia that throws", () => {
    vi.stubGlobal("matchMedia", () => {
      throw new Error("blocked");
    });
    const result = mount();
    intersect();
    settleIdle();
    expect(result.current.armed).toBe(true);
  });

  it("uses the idle callback when the browser has one", () => {
    const ric = vi.fn((cb: () => void) => {
      cb();
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", ric);
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    const result = mount();
    intersect();
    expect(ric).toHaveBeenCalled();
    expect(result.current.armed).toBe(true);
  });

  it("does not throw on cleanup when cancelIdleCallback is missing", () => {
    vi.stubGlobal("requestIdleCallback", () => 1);
    vi.stubGlobal("cancelIdleCallback", undefined);
    const { unmount } = render(createElement(Probe));
    expect(() => unmount()).not.toThrow();
  });

  it("stops RUNNING when the document hides, and stays ARMED", () => {
    // The canvas must not unmount — the loop pauses and resumes at the same `t`, and a
    // re-mount would re-fetch and restart the programme.
    const result = mount();
    intersect();
    settleIdle();
    expect(result.current.running).toBe(true);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current.running).toBe(false);
    expect(result.current.armed, "armed must latch").toBe(true);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current.running).toBe(true);
  });
});
