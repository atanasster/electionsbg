import { describe, expect, it } from "vitest";
import {
  FOV_Y_DEG,
  NEAR,
  PITCH_MAX,
  PITCH_MIN,
  blendCamera,
  cameraBasis,
  cameraPosition,
  clampPitch,
  groundPoint,
  project,
  projectWith,
} from "./camera";
import type { Camera, Viewport } from "./types";

const VIEW: Viewport = { w: 800, h: 500 };
const CAM: Camera = { target: [500, 312], distance: 900, pitch: 52, yaw: 0 };

describe("the pinhole camera", () => {
  it("puts the target dead centre, whatever the angle", () => {
    // The one invariant every camera path depends on: „look at Sofia" must mean Sofia is in
    // the middle of the frame, not somewhere near it.
    for (const yaw of [0, 45, 137, 300, -60]) {
      for (const pitch of [10, 35, 52, 80]) {
        const p = projectWith(
          groundPoint(CAM.target[0] * 10, CAM.target[1] * 10),
          { ...CAM, pitch, yaw },
          VIEW,
        )!;
        expect(p, `yaw ${yaw} pitch ${pitch}`).not.toBeNull();
        expect(p.x).toBeCloseTo(VIEW.w / 2, 6);
        expect(p.y).toBeCloseTo(VIEW.h / 2, 6);
        expect(p.depth).toBeCloseTo(CAM.distance, 6);
      }
    }
  });

  it("reports a depth that grows with distance from the camera", () => {
    const b = cameraBasis(CAM, VIEW);
    const near = project(groundPoint(5000, 3120), b)!;
    // Due north of the target, i.e. away from a yaw-0 camera standing to the south.
    const far = project(groundPoint(5000, 1000), b)!;
    expect(far.depth).toBeGreaterThan(near.depth);
    // …and the far point draws higher up the screen.
    expect(far.y).toBeLessThan(near.y);
  });

  it("raises a point of height along the screen's vertical", () => {
    const b = cameraBasis(CAM, VIEW);
    const base = project(groundPoint(5000, 3120, 0), b)!;
    const top = project(groundPoint(5000, 3120, 60), b)!;
    expect(top.y).toBeLessThan(base.y);
    expect(top.x).toBeCloseTo(base.x, 6);
  });

  it("clips what is behind the lens instead of folding it in front", () => {
    // A point beyond the camera projects with a NEGATIVE depth, and the naive division mirrors
    // it back into the frame — a polygon from the far side of the country drawn over the one
    // in front of it.
    const b = cameraBasis({ ...CAM, pitch: 10, distance: 200 }, VIEW);
    const behind = project([CAM.target[0], 0, CAM.target[1] + 10_000], b);
    expect(behind).toBeNull();
    expect(project([b.eye[0], b.eye[1], b.eye[2]], b)).toBeNull();
    expect(NEAR).toBeGreaterThan(0);
  });

  it("stands the camera above the ground at the declared distance", () => {
    const eye = cameraPosition(CAM);
    expect(eye[1]).toBeGreaterThan(0);
    expect(
      Math.hypot(eye[0] - CAM.target[0], eye[1], eye[2] - CAM.target[1]),
    ).toBeCloseTo(CAM.distance, 6);
  });

  it("clamps pitch at both ends, because both are degenerate", () => {
    // 90° makes `forward` parallel to world up, so `right` is a zero cross product and every
    // coordinate becomes NaN — the picture does not flatten, it disappears.
    expect(clampPitch(90)).toBe(PITCH_MAX);
    expect(clampPitch(0)).toBe(PITCH_MIN);
    expect(clampPitch(-40)).toBe(PITCH_MIN);
    for (const pitch of [0, 90, -10, 180]) {
      const p = projectWith(groundPoint(5000, 2000), { ...CAM, pitch }, VIEW);
      for (const v of [p?.x, p?.y, p?.depth]) {
        if (v !== undefined)
          expect(Number.isFinite(v), `pitch ${pitch}`).toBe(true);
      }
    }
  });

  it("scales with the viewport rather than baking a size in", () => {
    const small = projectWith(groundPoint(2000, 2000), CAM, {
      w: 400,
      h: 250,
    })!;
    const big = projectWith(groundPoint(2000, 2000), CAM, { w: 800, h: 500 })!;
    // Twice the viewport, twice the offset from centre.
    expect(big.x - 400).toBeCloseTo((small.x - 200) * 2, 6);
    expect(big.y - 250).toBeCloseTo((small.y - 125) * 2, 6);
    expect(FOV_Y_DEG).toBeGreaterThan(0);
  });
});

describe("blendCamera", () => {
  const A: Camera = { target: [100, 100], distance: 900, pitch: 50, yaw: 350 };
  const B: Camera = { target: [900, 500], distance: 90, pitch: 20, yaw: 10 };

  it("is the identity at both ends", () => {
    expect(blendCamera(A, B, 0)).toEqual(A);
    expect(blendCamera(A, B, 1)).toEqual(B);
  });

  it("holds the endpoint identity on a pair the geometric dolly gets wrong", () => {
    // ⚠️ 900 → 90 happens to round exactly, so the assertion above passes on a LUCKY CONSTANT.
    // Measured, 15 of 729 plausible keyframe pairs do not: 700 * pow(90/700, 1) comes back as
    // 89.99999999999999, and Remotion compares states at every scene boundary.
    const from = { ...A, distance: 700 };
    const to = { ...B, distance: 90 };
    expect(blendCamera(from, to, 1).distance).toBe(90);
    expect(blendCamera(from, to, 0).distance).toBe(700);
    // Mutation check: the unguarded expression really is inexact on this pair, so the
    // assertion above is not satisfied by an implementation that dropped the guard.
    expect(700 * Math.pow(90 / 700, 1)).not.toBe(90);
  });

  it("falls back to a linear dolly when a distance is not positive, and says nothing else", () => {
    // Reachable from a keyframe typo. The consequence is QUIET rather than loud: at distance 0
    // the eye coincides with the target, `norm`'s `|| 1` returns the zero vector rather than
    // NaN, every depth is 0, and `project` returns null for the whole scene — a blank canvas
    // at a 200. Pinned so a future reader knows it was chosen rather than overlooked.
    const zero = { ...A, distance: 0 };
    expect(blendCamera(zero, B, 0.5).distance).toBeCloseTo(45, 6);
    const blank = cameraBasis(zero, VIEW);
    expect(project(groundPoint(5000, 3120), blank)).toBeNull();
    expect(Number.isFinite(blank.focal)).toBe(true);
  });

  it("takes the SHORT way round a yaw that crosses zero", () => {
    // 350° → 10° is 20° of rotation. Linear interpolation sweeps 340° the other way, which
    // reads as the camera spinning once for no reason and is invisible in a keyframe table.
    // The midpoint is 360°, i.e. due north — the same angle as 0, expressed the way the sweep
    // reached it. Only the endpoints are pinned to their input.
    expect(blendCamera(A, B, 0.5).yaw).toBeCloseTo(360, 6);
    expect(
      blendCamera({ ...A, yaw: 10 }, { ...B, yaw: 350 }, 0.5).yaw,
    ).toBeCloseTo(0, 6);
    // Mutation check: a plain lerp would put the midpoint at 180° — pointing due south, the
    // long way round — which is the defect this rule exists to prevent.
    expect((A.yaw + B.yaw) / 2).toBeCloseTo(180, 6);
  });

  it("dollies geometrically, so half the move is half the zoom", () => {
    // 900 → 90 is a 10x change of SCALE. Linearly, half way through is 495 — 89% of the zoom
    // already spent — and the shot lurches then crawls.
    expect(blendCamera(A, B, 0.5).distance).toBeCloseTo(Math.sqrt(900 * 90), 6);
    expect(blendCamera(A, B, 0.5).distance).toBeLessThan(495);
  });

  it("clamps rather than extrapolating", () => {
    expect(blendCamera(A, B, -1)).toEqual(A);
    expect(blendCamera(A, B, 2)).toEqual(B);
  });
});
