/**
 * The accreting-canvas model.
 *
 * A short is a slideshow: each scene replaces the last, so nothing accumulates
 * and the result reads as a sequence of cards. An explainer keeps ONE visual
 * mounted for the whole video and lets each scene change it — a series fades in,
 * the window widens, a marker drops. Information accretes instead of resetting,
 * which is most of what separates the two formats.
 *
 * Mechanically that means the canvas must live OUTSIDE every `<Sequence>`, because
 * `useCurrentFrame()` is sequence-LOCAL and a persistent element needs absolute
 * time. Scenes therefore do not render the canvas; they declare a target STATE for
 * it, and the canvas interpolates between consecutive targets on the global clock.
 */

export type CanvasState = {
  /** Visible period window, as indices into the series. Animating it is the zoom. */
  from: number;
  to: number;
  /** Per-series opacity, 0..1. */
  bg: number;
  eu: number;
  ro: number;
  hr: number;
  /** Y-axis ceiling. Animated so a zoom-out does not squash the recent detail. */
  yMax: number;
  /** Vertical rule at a period index, or null. */
  marker: number | null;
  /** Shaded period range [from,to] drawing attention to a stretch, or null. */
  band: [number, number] | null;
  /** Dot + label on the latest BG point. */
  latestDot: number;
};

export const CANVAS_ZERO: CanvasState = {
  from: 0,
  to: 0,
  bg: 0,
  eu: 0,
  ro: 0,
  hr: 0,
  yMax: 8,
  marker: null,
  band: null,
  latestDot: 0,
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Blend two states. Numerics tween; the discrete ones (marker, band) SNAP at the
 * midpoint rather than interpolating — a vertical rule sliding across the chart
 * reads as a bug, and a band whose edges tween looks like data changing.
 */
export const blendCanvas = (
  a: CanvasState,
  b: CanvasState,
  t: number,
): CanvasState => ({
  from: lerp(a.from, b.from, t),
  to: lerp(a.to, b.to, t),
  bg: lerp(a.bg, b.bg, t),
  eu: lerp(a.eu, b.eu, t),
  ro: lerp(a.ro, b.ro, t),
  hr: lerp(a.hr, b.hr, t),
  yMax: lerp(a.yMax, b.yMax, t),
  latestDot: lerp(a.latestDot, b.latestDot, t),
  marker: t < 0.5 ? a.marker : b.marker,
  band: t < 0.5 ? a.band : b.band,
});

/**
 * Resolve the canvas state at an absolute frame.
 *
 * Each scene's partial target is merged onto the PREVIOUS resolved state, so a
 * scene only has to declare what it CHANGES — which is what makes the spec read
 * as a story rather than as a pile of chart configs.
 */
export const resolveCanvas = (
  scenes: { canvas?: Partial<CanvasState> }[],
  sceneDurations: number[],
  frame: number,
  fps: number,
  transitionSeconds = 0.9,
): CanvasState => {
  // Absolute target per scene, each built on the one before it.
  const targets: CanvasState[] = [];
  let acc: CanvasState = CANVAS_ZERO;
  for (const s of scenes) {
    acc = { ...acc, ...(s.canvas ?? {}) };
    targets.push(acc);
  }

  const starts: number[] = [];
  let t = 0;
  for (const d of sceneDurations) {
    starts.push(t);
    t += d;
  }

  let i = 0;
  while (i + 1 < starts.length && frame >= starts[i + 1]!) i++;

  const from = targets[i] ?? CANVAS_ZERO;
  const prev = i === 0 ? CANVAS_ZERO : targets[i - 1]!;
  const elapsed = (frame - (starts[i] ?? 0)) / fps;
  const p = Math.min(1, Math.max(0, elapsed / transitionSeconds));
  // Ease-out so the change lands with the narration rather than crawling.
  const eased = 1 - Math.pow(1 - p, 3);
  return blendCanvas(prev, from, eased);
};
