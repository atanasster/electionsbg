// The pinhole camera — `docs/plans/home-flyover-v1.md` §0.1 and §4.
//
// The map lies flat in the XZ plane and money rises along +Y. There is no map library and no
// projection here: the geometry arrived already projected (`scripts/geo/project_regions.ts`),
// so this file is arithmetic over a 1000×625 frame and nothing else.
//
// ⚠️ DEPTH IS RETURNED, NOT DISCARDED. Painter's-order sorting is the only depth resolution
// the engine has — there is no z-buffer on a 2D canvas — so every primitive has to be able to
// say how far away it is. A projector that returned only `x, y` would force each drawing site
// to invent its own ordering, and a column drawn behind the polygon it stands on is the
// failure that looks like a rendering engine bug rather than a missing sort key.

import { clamp01, lerp, lerpAngle } from "./math";
import type { Camera, Projected, Viewport } from "./types";

/** Vertical field of view, degrees. Fixed: a blendable FOV buys nothing and dollies badly. */
export const FOV_Y_DEG = 40;

/**
 * Pitch is clamped, and both ends matter.
 *
 * At 90° the camera is directly above the target, where the look-at basis is degenerate (the
 * forward vector is parallel to world up) and `right` is undefined — the picture does not
 * merely flatten, it becomes NaN. At 0° the camera sits on the ground plane and every column
 * projects to a horizontal line through the horizon.
 */
export const PITCH_MIN = 4;
export const PITCH_MAX = 86;

/** Nearer than this, in frame pixels, a point is behind the lens and is not drawn. */
export const NEAR = 1;

const DEG = Math.PI / 180;

export const clampPitch = (pitch: number): number =>
  pitch < PITCH_MIN ? PITCH_MIN : pitch > PITCH_MAX ? PITCH_MAX : pitch;

type Vec3 = readonly [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => {
  // ⚠️ The `|| 1` trades NaN for a BLANK FRAME, deliberately. It fires when the eye coincides
  // with the target — `distance === 0` from a keyframe typo — and returns the zero vector, so
  // every `depth` is 0 and `project` returns null for the whole scene. A blank canvas at a 200
  // is recoverable and reviewable; a basis of NaN propagates into every stored state.
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Where the camera stands, in world coordinates. */
export const cameraPosition = (cam: Camera): Vec3 => {
  const p = clampPitch(cam.pitch) * DEG;
  const y = cam.yaw * DEG;
  return [
    cam.target[0] + cam.distance * Math.cos(p) * Math.sin(y),
    cam.distance * Math.sin(p),
    cam.target[1] + cam.distance * Math.cos(p) * Math.cos(y),
  ];
};

/**
 * The camera's basis and focal length, computed ONCE per frame.
 *
 * ⚠️ Build this outside the draw loop. `project` takes it rather than a `Camera` precisely so
 * that a frame drawing ~1,900 polygon points does not recompute six trigonometric functions
 * and two cross products per point.
 */
export interface CameraBasis {
  eye: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  focal: number;
  cx: number;
  cy: number;
}

export const cameraBasis = (cam: Camera, viewport: Viewport): CameraBasis => {
  const eye = cameraPosition(cam);
  const target: Vec3 = [cam.target[0], 0, cam.target[1]];
  const forward = norm(sub(target, eye));
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return {
    eye,
    right,
    up,
    forward,
    focal: viewport.h / 2 / Math.tan((FOV_Y_DEG * DEG) / 2),
    cx: viewport.w / 2,
    cy: viewport.h / 2,
  };
};

/**
 * Project a world point. Returns `null` for anything at or behind the lens, which a caller
 * must treat as „do not draw this primitive" rather than as a zero.
 */
export const project = (p: Vec3, b: CameraBasis): Projected | null => {
  const d = sub(p, b.eye);
  const depth = dot(d, b.forward);
  if (depth <= NEAR) return null;
  return {
    x: b.cx + (b.focal * dot(d, b.right)) / depth,
    // Screen y grows DOWNWARD while world y is height, hence the subtraction.
    y: b.cy - (b.focal * dot(d, b.up)) / depth,
    depth,
  };
};

/**
 * A frame point in integer TENTHS → a world point at `heightPx` above the ground plane.
 *
 * ⚠️ Two units in one signature: the first two arguments are tenths (the artifact's grain) and
 * the third is frame pixels (the camera's). The parameter name carries it, because a column
 * ten times too short is a plausible rendering bug rather than an obvious one.
 */
export const groundPoint = (x10: number, y10: number, heightPx = 0): Vec3 => [
  x10 / 10,
  heightPx,
  y10 / 10,
];

/**
 * Convenience for the tests and for one-off probes: project a single point without hoisting
 * the basis. Never use it inside a draw loop — see `CameraBasis`.
 */
export const projectWith = (
  p: Vec3,
  cam: Camera,
  viewport: Viewport,
): Projected | null => project(p, cameraBasis(cam, viewport));

/**
 * Interpolate between two cameras. Distance is interpolated GEOMETRICALLY, because a dolly
 * from 900 to 90 frame pixels is a change of scale rather than of position: linearly, the
 * first half of the move covers 90% of the zoom and the shot lurches.
 */
export const blendCamera = (a: Camera, b: Camera, k: number): Camera => {
  const t = clamp01(k);
  return {
    target: [
      lerp(a.target[0], b.target[0], t),
      lerp(a.target[1], b.target[1], t),
    ],
    // ⚠️ THE ENDPOINTS RETURN THEIR INPUT EXACTLY, for the reason `lerpAngle` does: `a *
    // pow(b/a, 1)` is not exactly `b` in floating point — measured, 700 → 90 comes back as
    // 89.99999999999999 on 15 of 729 plausible keyframe pairs — and `blend(a, b, 1)` must be
    // value-equal to `b`, which Remotion compares at every scene boundary.
    distance:
      t <= 0
        ? a.distance
        : t >= 1
          ? b.distance
          : a.distance > 0 && b.distance > 0
            ? a.distance * Math.pow(b.distance / a.distance, t)
            : lerp(a.distance, b.distance, t),
    pitch: lerp(a.pitch, b.pitch, t),
    yaw: lerpAngle(a.yaw, b.yaw, t),
  };
};
