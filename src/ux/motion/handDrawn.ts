// Pen marks: the editorial „circle / underline the thing that matters", made to look like a
// hand did it. Two shapes — a loop (an ellipse that wobbles a little and overshoots its own
// start, the way a marker never quite closes; used on flipped map regions) and an underline (a
// slight wave that overshoots its end; used by `HandDrawnMark` on inline figures).
//
// ⚠️ DETERMINISTIC BY SEED, never Math.random(). The same mark must come out identical on
// every render and on both sides of hydration; a random wobble would redraw itself on every
// state change and read as the page twitching. Seed it with something stable about WHAT is
// being marked (a region id, a figure's role), so two marks differ while each stays put.

/** mulberry32 — tiny, fast, good enough for a wobble. */
const prng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

const f = (n: number) => Math.round(n * 100) / 100;

/** SVG path data for a hand-drawn loop around (cx, cy). Draw it with `pathLength="1"` and
 *  animate `stroke-dashoffset` 1 → 0 (the `.motion-draw-on` class) to have it drawn on. */
export const handDrawnLoopPath = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: string,
): string => {
  const rand = prng(hash(seed));
  const POINTS = 14;
  const turns = 1.12 + rand() * 0.08; // overshoot: the pen passes its own start
  const start = -Math.PI / 2 - 0.5 + rand() * 0.4; // begin near the top-left, like a hand
  const tilt = (rand() - 0.5) * 0.25;
  const pts: [number, number][] = [];
  for (let i = 0; i <= POINTS; i++) {
    const a = start + (i / POINTS) * turns * Math.PI * 2;
    // Radius drifts outward over the stroke so the overlap does not sit on top of the start.
    const drift = 1 + (i / POINTS) * 0.08 + (rand() - 0.5) * 0.06;
    const x = Math.cos(a) * rx * drift;
    const y = Math.sin(a) * ry * drift;
    pts.push([
      cx + x * Math.cos(tilt) - y * Math.sin(tilt),
      cy + x * Math.sin(tilt) + y * Math.cos(tilt),
    ]);
  }
  // Catmull-Rom through the points, emitted as cubic Béziers.
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
};

/** SVG path data for a hand-drawn underline across a 100 × 10 box: a slight wave that starts a
 *  little in and overshoots its end, as a marker stroke does. Deterministic by seed, like the
 *  loop. Draw it with `pathLength="1"` and `.motion-draw-on`. */
export const handDrawnUnderlinePath = (seed: string): string => {
  const rand = prng(hash(seed));
  const POINTS = 6;
  const pts: [number, number][] = [];
  for (let i = 0; i <= POINTS; i++) {
    const x = -1 + (i / POINTS) * 104;
    // Drift down a touch left to right, wobbling a pixel either way.
    const y = 4 + (i / POINTS) * 2 + (rand() - 0.5) * 2.4;
    pts.push([x, y]);
  }
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    d += ` Q${f((px + x) / 2)},${f(py + (rand() - 0.5) * 2)} ${f(x)},${f(y)}`;
  }
  return d;
};
