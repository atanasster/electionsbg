import { blendNumeric, resolveTimeline } from "./canvasTimeline";

/**
 * E2's canvas state — the election-risk explainer.
 *
 * Unlike E1, which tweens ONE chart's window and per-series opacity for its whole
 * run, this canvas has to carry an argument in three acts and change KIND once in
 * the middle:
 *
 *   act 1  five integrity meters, filling one at a time            (`m1`…`m5`)
 *   act 2  they collapse into a single column of 47                (`mode`, `avg`)
 *   act 3  that column takes its place among seven, against the
 *          band boundaries that make 47 read as «Висок»            (`history`, `bands`)
 *   coda   a context strip drops in below with the other five      (`ctx`, `c1`…`c5`)
 *
 * The collapse is the one moment the canvas changes kind, and it IS the argument:
 * five measurements becoming the single number the video opened on. Everything
 * else accretes.
 *
 * ── WHY FIVE SCALARS AND NOT AN ARRAY ─────────────────────────────────────────
 * `m1`…`m5` rather than `meters: number[]`, and likewise `c1`…`c5`. Two reasons,
 * both practical: the timeline merges each scene's PARTIAL onto the previous
 * resolved state, and a partial array would replace rather than merge (so a scene
 * lighting meter 3 would have to restate 1 and 2); and `blendNumeric` tweens
 * numeric fields and snaps everything else, so an array would snap — the fill
 * would pop instead of growing. Verbose in the spec, correct in the render.
 *
 * Every field is 0..1 opacity/progress unless documented otherwise.
 */
export type RiskCanvasState = {
  /** 0 = the five meters, 1 = the seven history columns. The collapse. */
  mode: number;
  /**
   * The five labelled meter ROWS — tracks with no fill yet. Separate from the
   * fills so the structure can be established before any number is claimed; a
   * shared field would make "row present" indistinguishable from "score is ~2".
   */
  rows: number;
  /** Integrity meters, in page order: секции · машини · флаш · концентрация · процедури. */
  m1: number;
  m2: number;
  m3: number;
  m4: number;
  m5: number;
  /**
   * Which meter (1..5) is the subject right now, or null. The focused meter keeps
   * full contrast while the rest recede — discrete, so it snaps rather than
   * sliding through the meters between it and the next one.
   */
  focus: number | null;
  /**
   * Draw the FOCUSED meter's scale end (its cap) as the thing its measured value
   * is approaching. Every signal has one and the script states each, but scene 16
   * is what it exists for: 0,18% reads as 90 only because the scale stops at 0,2%.
   */
  scaleTag: number;
  /** The single averaged column, 47. */
  avg: number;
  /** The other six comparable elections around it. */
  history: number;
  /** Horizontal rule at the seven-cycle mean, 54. */
  meanLine: number;
  /** Callout on the 06.2024 peak, 77. */
  peakTag: number;
  /** The four band backgrounds (спокоен/повишен/висок/критичен). */
  bands: number;
  /** Emphasis on the 40 boundary — the one that puts 47 in «Висок». */
  bandRule: number;
  /** The context strip below the main plot. */
  ctx: number;
  /**
   * Which context signal (1..5) the MAIN PLOT is showing the history of, or null
   * for the integrity index's own seven columns.
   *
   * Without this the index columns stayed up through the whole context section
   * while the narration talked about a different series entirely — "второто
   * най-високо от дванайсет измервания" over a chart of seven. Discrete, so it
   * snaps rather than cross-fading two unrelated column sets through each other.
   *
   * While it is set, the index-specific furniture (band backgrounds, the mean
   * line, the «висок» rule, the peak callout) is suppressed: those describe the
   * composite's calibration and mean nothing on a component's series.
   */
  ctxFocus: number | null;
  /** Context meters: Бенфорд · махали · волатилност · социология · клъстери. */
  c1: number;
  c2: number;
  c3: number;
  c4: number;
  c5: number;
  /** The callout panel under the meters. */
  inset: number;
  /**
   * WHICH callout — the section-band split, or the 592 → 145 concentration pair
   * with its turnouts. Discrete, so it snaps rather than cross-dissolving two
   * panels of unrelated numbers through each other.
   */
  insetKind: "sections" | "concentration" | null;
  /** Pull everything back for the closing beats. */
  dim: number;
};

export const RISK_CANVAS_ZERO: RiskCanvasState = {
  mode: 0,
  rows: 0,
  m1: 0,
  m2: 0,
  m3: 0,
  m4: 0,
  m5: 0,
  focus: null,
  scaleTag: 0,
  avg: 0,
  history: 0,
  meanLine: 0,
  peakTag: 0,
  bands: 0,
  bandRule: 0,
  ctx: 0,
  ctxFocus: null,
  c1: 0,
  c2: 0,
  c3: 0,
  c4: 0,
  c5: 0,
  inset: 0,
  insetKind: null,
  dim: 0,
};

/**
 * Numerics tween. Everything else snaps — but WHEN it snaps depends on what it
 * selects, and the two cases are easy to conflate:
 *
 * • **Emphasis** on something already drawn — `focus`, which dims the meters that
 *   are not the subject — may snap at the transition MIDPOINT. Arriving half a
 *   beat late reads as easing.
 *
 * • **What is drawn at all** — `ctxFocus` (which SERIES the main plot charts) and
 *   `insetKind` (which callout the panel holds) — must snap at the scene
 *   BOUNDARY. At the midpoint the canvas spends ~0.45 s showing the previous
 *   chart while the rail already names the new signal, which is a visible flicker
 *   of the wrong data and reads as a rendering fault. Taking them from `b`
 *   unconditionally cuts them on the boundary instead, in step with the narration.
 */
export const blendRiskCanvas = (
  a: RiskCanvasState,
  b: RiskCanvasState,
  t: number,
): RiskCanvasState => ({
  ...blendNumeric(a, b, t),
  ctxFocus: b.ctxFocus,
  insetKind: b.insetKind,
});

export const resolveRiskCanvas = (
  scenes: { canvas?: Partial<RiskCanvasState> }[],
  sceneDurations: number[],
  frame: number,
  fps: number,
  transitionSeconds = 0.9,
): RiskCanvasState =>
  resolveTimeline(
    RISK_CANVAS_ZERO,
    blendRiskCanvas,
    scenes,
    sceneDurations,
    frame,
    fps,
    transitionSeconds,
  );
