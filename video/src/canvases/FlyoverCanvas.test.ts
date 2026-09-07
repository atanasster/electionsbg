import { describe, expect, it } from "vitest";
import { createRecorder } from "../../../src/lib/flyover/recorder";
import { ARTICLE_CHAPTERS } from "../../../src/lib/flyover/programmes/tour";
import { drawFlyoverFrame } from "./flyoverRenderer";
import { resolveFlyoverCanvas } from "../lib/flyoverCanvasState";

const scenes = ARTICLE_CHAPTERS.slice(0, 2).map((chapter) => ({
  canvas: chapter.state,
}));
const durations = [90, 90];

describe("flyover video canvas", () => {
  it("accretes chapter partials through the shared absolute timeline", () => {
    const first = resolveFlyoverCanvas(scenes, durations, 60, 30);
    expect(first.weights.proc).toBe(1);
    expect(first.arcs).toBe(0);

    const second = resolveFlyoverCanvas(scenes, durations, 120, 30);
    expect(second.weights.proc).toBe(0);
    expect(second.arcs).toBe(1);
    // Chapter two omits labels, so it inherits chapter one's value.
    expect(second.labels).toBe(0.4);
  });

  it("starts, blends, and completes the transition on absolute frames", () => {
    const atBoundary = resolveFlyoverCanvas(scenes, durations, 90, 30);
    expect(atBoundary.arcs).toBe(0);
    expect(atBoundary.weights.proc).toBe(1);

    const midway = resolveFlyoverCanvas(scenes, durations, 103, 30);
    expect(midway.arcs).toBeGreaterThan(0);
    expect(midway.arcs).toBeLessThan(1);
    expect(midway.weights.proc).toBeCloseTo(1 - midway.arcs, 10);

    const complete = resolveFlyoverCanvas(scenes, durations, 117, 30);
    expect(complete.arcs).toBe(1);
    expect(complete.weights.proc).toBe(0);

    const slower = resolveFlyoverCanvas(scenes, durations, 117, 30, 1.8);
    expect(slower.arcs).toBeGreaterThan(0);
    expect(slower.arcs).toBeLessThan(1);
  });

  it("draws the generated world and advances only continuous motion with the clock", () => {
    const state = resolveFlyoverCanvas(scenes, durations, 120, 30);
    const a = createRecorder();
    const b = createRecorder();
    drawFlyoverFrame(a, state, { w: 1124, h: 872 }, 0);
    drawFlyoverFrame(b, state, { w: 1124, h: 872 }, 1);
    expect(a.ops("fill").length).toBeGreaterThan(0);
    expect(a.ops("quadraticCurveTo").length).toBeGreaterThan(0);
    expect(a.log()).not.toEqual(b.log());
    const withoutClock = (log: string[]) =>
      log.filter((line) => !line.startsWith("set:lineDashOffset"));
    expect(withoutClock(a.log())).toEqual(withoutClock(b.log()));
  });
});
