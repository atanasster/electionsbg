import { blendNumeric, resolveTimeline } from "./canvasTimeline";

/**
 * E1's canvas state — the inflation line chart.
 *
 * The timeline machinery (merge each scene's partial onto the previous resolved
 * state, ease between consecutive targets on the ABSOLUTE clock) is shared with
 * every other canvas and lives in `canvasTimeline.ts`. This file is only the
 * shape of THIS chart plus its zero.
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

/**
 * Numerics tween; `marker` and `band` snap at the midpoint — see `blendNumeric`
 * for why a sliding rule and a tweening band both read as bugs.
 */
export const blendCanvas = (
  a: CanvasState,
  b: CanvasState,
  t: number,
): CanvasState => blendNumeric(a, b, t);

export const resolveCanvas = (
  scenes: { canvas?: Partial<CanvasState> }[],
  sceneDurations: number[],
  frame: number,
  fps: number,
  transitionSeconds = 0.9,
): CanvasState =>
  resolveTimeline(
    CANVAS_ZERO,
    blendCanvas,
    scenes,
    sceneDurations,
    frame,
    fps,
    transitionSeconds,
  );
