// `FlyoverState` — the one unit every caller of the engine exchanges, and the reason it is a
// blendable record rather than a `t` into a fixed loop (`docs/plans/home-flyover-v1.md` §0.2).
//
// Two callers, two sources of state:
//
//   · the money-map article accretes the chapter table (`programmes/tour.ts`) and blends
//     between chapters by scroll position;
//   · Remotion's `resolveTimeline` blends each scene's PARTIAL state over the durations the
//     NARRATION measured, which is why the unit has to be blendable.
//
// ⚠️ A `Partial<FlyoverState>` THAT OMITS A FIELD INHERITS THE PREVIOUS SCENE'S VALUE under
// `resolveTimeline` — that is how the accreting canvas works. So a video scene that wants the
// arcs OFF must say `arcs: 0`; leaving the field out leaves them on (plan §14).

import { blendCamera } from "./camera";
import { clamp01, lerp } from "./math";
import type { Camera, LayerId } from "./types";

/**
 * One frame's worth of scene, fully determined and fully blendable.
 *
 * Every NUMBER here interpolates; the one non-number switches at the halfway point, because a
 * highlighted oblast is an identity rather than a quantity and there is no meaningful value
 * between „Пловдив" and „Варна".
 */
export interface FlyoverState {
  camera: Camera;
  /** Per-layer weight, 0..1. Chapters cross-fade between money layers with these. */
  weights: Record<LayerId, number>;
  /** Arc visibility, 0..1. */
  arcs: number;
  /** City-label opacity, 0..1 — the only text the canvas itself draws. */
  labels: number;
  /** The oblast to pick out, or `null`. An identity: it switches, it does not interpolate. */
  highlight: string | null;
}

/** Every layer off — the base a chapter's weight patch is written against. */
export const ZERO_WEIGHTS: Record<LayerId, number> = {
  proc: 0,
  funds: 0,
  agri: 0,
  elections: 0,
  prices: 0,
};

/**
 * The neutral state: the whole country in view, nothing weighted.
 *
 * It is the base `resolveTimeline` and the article accrete onto, and the fallback a host
 * renders before anything has been resolved — so it must be a legible picture of Bulgaria rather than
 * an empty one.
 */
export const STATE_ZERO: FlyoverState = {
  camera: { target: [500, 312], distance: 900, pitch: 52, yaw: 0 },
  weights: { ...ZERO_WEIGHTS },
  arcs: 0,
  labels: 0,
  highlight: null,
};

/** A deep copy, so a caller mutating a returned state cannot reach into a keyframe table. */
export const cloneState = (s: FlyoverState): FlyoverState => ({
  camera: { ...s.camera, target: [s.camera.target[0], s.camera.target[1]] },
  weights: { ...s.weights },
  arcs: s.arcs,
  labels: s.labels,
  highlight: s.highlight,
});

/**
 * Blend two states. `k = 0` is `a`, `k = 1` is `b`, and the identity field switches at the
 * halfway point.
 *
 * ⚠️ `blend(a, b, 0)` must be VALUE-equal to `a` and `blend(a, b, 1)` to `b` — Remotion's
 * timeline relies on it at every scene boundary, where a discontinuity is a visible jump on
 * the frame the narration lands on.
 */
export const blend = (
  a: FlyoverState,
  b: FlyoverState,
  k: number,
): FlyoverState => {
  const t = clamp01(k);
  const weights = { ...ZERO_WEIGHTS };
  for (const id of Object.keys(weights) as LayerId[]) {
    weights[id] = lerp(a.weights[id] ?? 0, b.weights[id] ?? 0, t);
  }
  return {
    // ⚠️ ONE camera-blend rule, shared with Remotion and the article — a second copy here is
    // how a dolly ends up linear in one caller and geometric in another.
    camera: blendCamera(a.camera, b.camera, t),
    weights,
    arcs: lerp(a.arcs, b.arcs, t),
    labels: lerp(a.labels, b.labels, t),
    // An identity, not a quantity: there is nothing between two oblasts.
    highlight: t < 0.5 ? a.highlight : b.highlight,
  };
};

/**
 * Fold a PARTIAL state onto a base — Remotion's accretion rule, exported so the article
 * cannot implement a second, differing one.
 */
export const applyPartial = (
  base: FlyoverState,
  patch: Partial<FlyoverState>,
): FlyoverState => {
  const camera = patch.camera
    ? { ...base.camera, ...patch.camera }
    : base.camera;
  return {
    // ⚠️ COPY, NEVER ALIAS — the rule `cloneState` exists for, and it matters more here.
    // `resolveTimeline` accretes onto STATE_ZERO, which is a module-level singleton AND the
    // neutral picture every host renders before anything is resolved. Returning its
    // `weights` by reference means one in-place write by a cross-fade helper poisons every
    // later frame in the process, with nothing failing.
    camera: { ...camera, target: [camera.target[0], camera.target[1]] },
    // Spreading `undefined` is a no-op, so this is the same merge with one branch fewer.
    weights: { ...base.weights, ...patch.weights },
    arcs: patch.arcs ?? base.arcs,
    labels: patch.labels ?? base.labels,
    // `null` is a MEANINGFUL value — "stop highlighting" — so `??` would make it unclearable.
    // Presence of the key is the test.
    highlight:
      "highlight" in patch ? (patch.highlight ?? null) : base.highlight,
  };
};
