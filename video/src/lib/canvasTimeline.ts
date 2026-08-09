/**
 * The accreting-canvas timeline, independent of what is being drawn.
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
 *
 * This file is the part that does not care WHICH canvas: E1 tweens a line chart's
 * window and per-series opacity, E2 tweens five meters into seven columns. Both
 * want the same "merge each scene's partial onto the previous resolved state, then
 * ease between consecutive targets" behaviour, so it lives here once.
 */

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Blend every NUMERIC field and SNAP everything else at the midpoint.
 *
 * Snapping is not laziness: a vertical rule sliding across a chart reads as a
 * bug, and a highlighted range whose edges tween looks like the data changing.
 * Anything discrete (a marker index, a band tuple, a focused item) belongs on the
 * non-numeric side.
 */
export const blendNumeric = <T extends object>(a: T, b: T, t: number): T => {
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(a) as (keyof T & string)[]) {
    const av = a[k] as unknown;
    const bv = b[k] as unknown;
    out[k] =
      typeof av === "number" && typeof bv === "number"
        ? lerp(av, bv, t)
        : t < 0.5
          ? av
          : bv;
  }
  return out as T;
};

/**
 * Resolve the canvas state at an absolute frame.
 *
 * Each scene's partial target is merged onto the PREVIOUS resolved state, so a
 * scene only has to declare what it CHANGES — which is what makes the spec read
 * as a story rather than as a pile of chart configs.
 */
export const resolveTimeline = <T extends object>(
  zero: T,
  blend: (a: T, b: T, t: number) => T,
  scenes: { canvas?: Partial<T> }[],
  sceneDurations: number[],
  frame: number,
  fps: number,
  transitionSeconds = 0.9,
): T => {
  // Absolute target per scene, each built on the one before it.
  const targets: T[] = [];
  let acc: T = zero;
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

  const to = targets[i] ?? zero;
  const prev = i === 0 ? zero : targets[i - 1]!;
  const elapsed = (frame - (starts[i] ?? 0)) / fps;
  const p = Math.min(1, Math.max(0, elapsed / transitionSeconds));
  // Ease-out so the change lands with the narration rather than crawling.
  const eased = 1 - Math.pow(1 - p, 3);
  return blend(prev, to, eased);
};
