import { describe, expect, it } from "vitest";
import { clamp01, lerp, lerpAngle, smoothstep } from "./math";

describe("lerpAngle", () => {
  it("returns its inputs exactly at the ends", () => {
    // Not cosmetic: the short-way sum from 350 to 10 lands on 370, the same rotation and a
    // different number, and Remotion compares states at every scene boundary.
    expect(lerpAngle(350, 10, 0)).toBe(350);
    expect(lerpAngle(350, 10, 1)).toBe(10);
    expect(lerpAngle(-30, 400, 0)).toBe(-30);
    expect(lerpAngle(-30, 400, 1)).toBe(400);
  });

  it("crosses zero the short way in both directions", () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(360, 6);
    expect(lerpAngle(10, 350, 0.5)).toBeCloseTo(0, 6);
    expect(lerpAngle(0, 90, 0.5)).toBeCloseTo(45, 6);
  });

  it("resolves the 180° tie the same way every time", () => {
    // Both directions are equally short, so an unpinned rule makes the sweep depend on a
    // floating-point sign — the camera turning left in one build and right in the next.
    expect(lerpAngle(0, 180, 0.5)).toBe(90);
    expect(lerpAngle(180, 0, 0.5)).toBe(270);
  });

  it("clamps outside [0, 1] rather than extrapolating", () => {
    expect(lerpAngle(350, 10, -5)).toBe(350);
    expect(lerpAngle(350, 10, 5)).toBe(10);
  });
});

describe("lerp / clamp01 / smoothstep", () => {
  it("lerp is exact at the ends", () => {
    expect(lerp(2, 8, 0)).toBe(2);
    expect(lerp(2, 8, 1)).toBe(8);
    expect(lerp(2, 8, 0.5)).toBe(5);
  });

  it("clamp01 pins both ends", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.25)).toBe(0.25);
  });

  it("smoothstep eases in and out, and clamps its input", () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBe(0.5);
    // The point of it: slower than linear at the ends, faster in the middle.
    expect(smoothstep(0.25)).toBeLessThan(0.25);
    expect(smoothstep(0.75)).toBeGreaterThan(0.75);
    // Unclamped, `k*k*(3-2k)` turns back on itself past 1 — 1.5 maps to 0, i.e. a camera
    // that overshoots a keyframe would snap back to the start of the move.
    expect(smoothstep(1.5)).toBe(1);
    expect(smoothstep(-0.5)).toBe(0);
  });
});
