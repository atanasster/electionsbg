// What one frame costs, measured against the same engine the browser runs.
//
// ⚠️ THIS IS A PROXY AND IS NAMED AS ONE. It measures `@napi-rs/canvas` on whatever machine
// runs the suite — a Skia rasteriser in Node, not a browser's 2D context on a 2019 laptop, and
// the plan's ≤ 4 ms target is for the latter. What it can honestly catch is a REGRESSION in
// the engine's own arithmetic: the frame doing an order of magnitude more work than it did, on
// a corpus of 31 polygons, 28 columns and 40 arcs.
//
// It lives under `scripts/` because `vitest.config.ts` runs `src/**` in jsdom, where there is
// no canvas at all.
//
//   npx vitest run scripts/home/flyover_bench.test.ts --project node

import { describe, expect, it } from "vitest";
import { drawFrame, loadWorld, POSTER_H, POSTER_W } from "./flyover_posters";
import { PROGRAMMES, stateAt } from "../../src/lib/flyover/programmes";

/**
 * A generous ceiling, deliberately.
 *
 * ⚠️ A tight budget on shared CI hardware is a flaky test, and a flaky perf test is worse than
 * none: it gets skipped, and then it is not a gate at all. This is set where an ORDER of
 * magnitude fails and ordinary noise does not — the measured cost on a 2026 laptop is a few
 * milliseconds. `tests/perf.spec.ts` owns the real page budgets.
 */
const CEILING_MS = 60;

const WARMUP = 3;
const RUNS = 12;

const median = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

describe("one frame's cost", () => {
  const world = loadWorld();

  it.each(Object.values(PROGRAMMES))(
    "$id: draws a full-size frame well inside the ceiling",
    (p) => {
      // The busiest moment of each loop rather than t=0: the arcs programme opens with the
      // camera high and every arc on screen, and the columns one is heaviest mid-cross-fade
      // where BOTH layers are partly drawn.
      const t = p.duration / 2;
      for (let i = 0; i < WARMUP; i++) {
        drawFrame({
          world,
          programme: p.id,
          t,
          width: POSTER_W,
          height: POSTER_H,
        });
      }
      const times: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const started = performance.now();
        drawFrame({
          world,
          programme: p.id,
          t,
          width: POSTER_W,
          height: POSTER_H,
        });
        times.push(performance.now() - started);
      }
      const ms = median(times);
      // Reported on every run: the number is the point, the ceiling is only the tripwire.
      console.log(`flyover_bench: ${p.id} median ${ms.toFixed(2)} ms/frame`);
      expect(ms).toBeLessThan(CEILING_MS);
    },
  );

  it("scales with the viewport rather than with the corpus", () => {
    // The engine projects every point per frame, so cost tracks the POINT COUNT, which is
    // fixed by the artifact. A quarter-size frame must not cost a quarter as much — if it
    // does, the rasteriser dominates and this bench is measuring Skia rather than the engine.
    const big = () =>
      drawFrame({
        world,
        programme: "arcs",
        t: 5,
        width: POSTER_W,
        height: POSTER_H,
      });
    const small = () =>
      drawFrame({ world, programme: "arcs", t: 5, width: 250, height: 156 });
    for (let i = 0; i < WARMUP; i++) {
      big();
      small();
    }
    const time = (f: () => unknown) => {
      const t: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const s = performance.now();
        f();
        t.push(performance.now() - s);
      }
      return median(t);
    };
    const ratio = time(big) / Math.max(time(small), 1e-6);
    console.log(`flyover_bench: 16x the pixels costs ${ratio.toFixed(1)}x`);
    // ⚠️ NOT 16. A purely rasteriser-bound frame lands AT ~16, i.e. exactly on the value this
    // is testing for, and would pass or fail on noise. Measured 2026-09-06: 0.9x — the
    // per-point projection is fixed by the artifact, so the real ratio is nowhere near
    // linear. Set with room on both sides, as `CEILING_MS` is.
    const SCALING_CEILING = 8;
    expect(ratio).toBeLessThan(SCALING_CEILING);
  });

  it("costs nothing to ask a programme for a state", () => {
    // `stateAt` runs on every animation frame in the browser and must stay arithmetic: it
    // resolves the keyframes once and then blends two records.
    const started = performance.now();
    for (let i = 0; i < 20_000; i++) stateAt(PROGRAMMES.tour, i * 0.002);
    const ms = performance.now() - started;
    console.log(`flyover_bench: 20,000 stateAt calls in ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(1_000);
  });
});
