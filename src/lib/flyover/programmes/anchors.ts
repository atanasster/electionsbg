// Camera anchors in FRAME PIXELS, read off the committed artifact's `geo.cities`.
//
// ⚠️ THESE ARE CONSTANTS AND THE ARTIFACT'S POINTS ARE THE TRUTH. A camera path cannot read
// `world.geo.cities`, because `stateAt` takes no world — a keyframe table is static by design,
// which is what lets the article map scroll to a state and Remotion reuse the same states with
// its own timing. So the numbers are copied here ONCE, and `programmes.test.ts` reads the
// artifact and fails when they drift more than a couple of pixels. A re-projection (a new
// simplification tolerance, a changed frame) moves the map; the gate is what moves the camera
// with it instead of leaving it looking at empty sea.
//
// Measured 2026-09-06 from `data/home/flyover.json` (frame 1000 × 625).

/** The whole country, which is where every loop begins and ends. */
export const OVERVIEW: readonly [number, number] = [500, 312];

export const SOFIA: readonly [number, number] = [176, 324];
export const PLOVDIV: readonly [number, number] = [390, 431];
export const STARA_ZAGORA: readonly [number, number] = [523, 377];
export const BURGAS: readonly [number, number] = [798, 361];
export const VARNA: readonly [number, number] = [866, 217];

/** How far the tolerance gate allows an anchor to drift from the artifact, in frame pixels. */
export const ANCHOR_TOLERANCE_PX = 3;

/** Which oblast each anchor is taken from — the gate's join back to the artifact. */
export const ANCHOR_SOURCES: Readonly<
  Record<string, readonly [number, number]>
> = {
  SOF: SOFIA,
  PDV: PLOVDIV,
  SZR: STARA_ZAGORA,
  BGS: BURGAS,
  VAR: VARNA,
};
