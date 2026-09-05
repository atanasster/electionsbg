import { describe, expect, it } from "vitest";
import {
  STATE_ZERO,
  applyPartial,
  blend,
  cloneState,
  type FlyoverState,
} from "./state";
import { LAYER_IDS } from "./types";

const A: FlyoverState = {
  camera: { target: [100, 100], distance: 800, pitch: 50, yaw: 350 },
  weights: { proc: 1, funds: 0, agri: 0, elections: 0, prices: 0 },
  arcs: 0,
  labels: 0.2,
  highlight: "SOF",
  captionId: "columns_proc",
};

const B: FlyoverState = {
  camera: { target: [900, 500], distance: 200, pitch: 20, yaw: 10 },
  weights: { proc: 0, funds: 1, agri: 0, elections: 0, prices: 0 },
  arcs: 1,
  labels: 1,
  highlight: "VAR",
  captionId: "columns_funds",
};

describe("blend", () => {
  it("is the identity at both ends", () => {
    // Remotion's timeline relies on this at every scene boundary: a discontinuity here is a
    // visible jump on exactly the frame the narration lands on.
    expect(blend(A, B, 0)).toEqual(A);
    expect(blend(A, B, 1)).toEqual(B);
  });

  it("clamps rather than extrapolating past a scene", () => {
    expect(blend(A, B, -0.5)).toEqual(A);
    expect(blend(A, B, 1.5)).toEqual(B);
  });

  it("interpolates every weight, including the ones neither side sets", () => {
    const mid = blend(A, B, 0.5);
    expect(mid.weights.proc).toBeCloseTo(0.5, 6);
    expect(mid.weights.funds).toBeCloseTo(0.5, 6);
    for (const id of LAYER_IDS) {
      expect(Number.isFinite(mid.weights[id]), id).toBe(true);
    }
    expect(Object.keys(mid.weights).sort()).toEqual([...LAYER_IDS].sort());
  });

  it("switches the identities at the halfway point instead of fading through", () => {
    // There is nothing between „София" and „Варна", and a caption that faded through a third
    // would say something nobody wrote.
    expect(blend(A, B, 0.49).highlight).toBe("SOF");
    expect(blend(A, B, 0.5).highlight).toBe("VAR");
    expect(blend(A, B, 0.49).captionId).toBe("columns_proc");
    expect(blend(A, B, 0.5).captionId).toBe("columns_funds");
  });

  it("clamps a NaN k to the start rather than producing a NaN frame", () => {
    // Every host derives `k` by division — a rAF clock, a scroll ratio, `frame / (fps *
    // duration)` — so `0/0` on a first frame is ordinary. Ungated, every number in the state
    // becomes NaN (a blank canvas) while `highlight` and `captionId` still advance to `b`,
    // because both `NaN < 0.5` comparisons are false: a caption narrating an empty picture.
    const out = blend(A, B, Number.NaN);
    expect(out).toEqual(A);
    expect(Number.isNaN(out.camera.distance)).toBe(false);
    expect(out.captionId).toBe("columns_proc");
  });

  it("is continuous in every number it interpolates", () => {
    const before = blend(A, B, 0.5 - 1e-6);
    const after = blend(A, B, 0.5 + 1e-6);
    expect(after.arcs - before.arcs).toBeLessThan(1e-4);
    expect(
      Math.abs(after.camera.distance - before.camera.distance),
    ).toBeLessThan(1e-2);
  });

  it("does not alias either input", () => {
    const mid = blend(A, B, 0.5);
    mid.weights.proc = 99;
    mid.camera = { ...mid.camera, target: [0, 0] };
    expect(A.weights.proc).toBe(1);
    expect(A.camera.target).toEqual([100, 100]);
    expect(blend(A, B, 0).camera.target).not.toBe(A.camera.target);
    expect(blend(A, B, 1).weights).not.toBe(B.weights);
  });
});

describe("STATE_ZERO", () => {
  it("frames the whole country rather than nothing", () => {
    // It is the base Remotion accretes onto AND what a host renders before a programme has
    // produced anything, so „neutral" must still be a legible picture.
    expect(STATE_ZERO.camera.distance).toBeGreaterThan(400);
    expect(STATE_ZERO.camera.target[0]).toBeGreaterThan(300);
    expect(STATE_ZERO.camera.target[0]).toBeLessThan(700);
    expect(STATE_ZERO.captionId).toBeNull();
    for (const id of LAYER_IDS) expect(STATE_ZERO.weights[id], id).toBe(0);
  });

  it("cannot be mutated through a clone", () => {
    const c = cloneState(STATE_ZERO);
    c.weights.proc = 1;
    c.camera = { ...c.camera, target: [0, 0] };
    expect(STATE_ZERO.weights.proc).toBe(0);
    expect(STATE_ZERO.camera.target[0]).toBe(500);
    // A fresh tuple, not the shared one — `Camera.target` is readonly to the type checker,
    // which is no help to a caller that has cast it away.
    expect(cloneState(STATE_ZERO).camera.target).not.toBe(
      STATE_ZERO.camera.target,
    );
    expect(cloneState(STATE_ZERO).weights).not.toBe(STATE_ZERO.weights);
  });
});

describe("applyPartial", () => {
  it("inherits every field the patch omits", () => {
    // This IS the accretion rule: a video scene that says nothing about the arcs keeps the
    // previous scene's arcs, which is why a scene that wants them off must say `arcs: 0`.
    const out = applyPartial(A, { arcs: 1 });
    expect(out.arcs).toBe(1);
    expect(out.weights).toEqual(A.weights);
    expect(out.highlight).toBe("SOF");
    expect(out.captionId).toBe("columns_proc");
  });

  it("lets a patch CLEAR an identity, which `??` alone would not", () => {
    // `null` is a meaningful value for both — „stop highlighting", „say nothing" — so the test
    // is the presence of the key, not the truthiness of the value.
    expect(applyPartial(A, { highlight: null }).highlight).toBeNull();
    expect(applyPartial(A, { captionId: null }).captionId).toBeNull();
    expect(applyPartial(A, {}).highlight).toBe("SOF");
  });

  it("merges a partial camera rather than replacing it", () => {
    const out = applyPartial(A, { camera: { ...A.camera, yaw: 90 } });
    expect(out.camera.yaw).toBe(90);
    expect(out.camera.distance).toBe(A.camera.distance);
  });

  it("does not alias its base — including the STATE_ZERO singleton", () => {
    // `resolveTimeline` accretes onto STATE_ZERO, which is both the module-level neutral
    // picture and the fallback every host renders before a programme produces anything. An
    // aliased `weights` means one in-place write poisons every later frame in the process,
    // and `toEqual` cannot see it.
    const out = applyPartial(A, { arcs: 1 });
    expect(out.weights).not.toBe(A.weights);
    expect(out.camera).not.toBe(A.camera);
    expect(out.camera.target).not.toBe(A.camera.target);
    out.weights.proc = 99;
    expect(A.weights.proc).toBe(1);

    const z = applyPartial(STATE_ZERO, { arcs: 1 });
    z.weights.agri = 99;
    expect(STATE_ZERO.weights.agri).toBe(0);
  });

  it("merges partial weights, so one layer can be raised without zeroing the rest", () => {
    const out = applyPartial(A, {
      weights: { ...A.weights, agri: 1 },
    });
    expect(out.weights.agri).toBe(1);
    expect(out.weights.proc).toBe(1);
  });
});
