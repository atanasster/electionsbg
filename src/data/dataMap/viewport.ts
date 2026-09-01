import type { DataMapManifest } from "./useDataMap";

/**
 * Viewport maths for the data map — the ONE place that decides how the graph
 * is framed inside its canvas box, and the one place the screen's aspect-ratio
 * box gets its extent from.
 *
 * It exists because React Flow's own `fitView` cannot be relied on here. On
 * first paint the flow logs error #004 ("the parent container needs a width
 * and a height") and the viewport stays at the identity transform, so the
 * 1046 x 3684 graph renders at 1:1 anchored top-left. Measured 2026-09-01 in
 * Chromium at 375 / 768 / 1024 / 1280 / 1440 px: identical at every width on a
 * fresh load. At 375 that leaves the dataset and feature tiers ENTIRELY
 * off-canvas — a phone sees roughly 12% of the map — while at 1440 it only
 * clips the feature column by ~38px, which is why the failure went unnoticed
 * on a laptop. The zoom +/- buttons work and the fit button does not, so the
 * store's own width/height are sound and it is the node BOUNDS that fitView
 * cannot resolve.
 *
 * The manifest already carries every node's box, so the bounds never need to
 * be measured from the DOM: these functions derive them and the canvas hands
 * React Flow an explicit `setViewport`. Deterministic, and unit-testable
 * without a browser.
 */

export type DataMapBox = { x: number; y: number; w: number; h: number };

export type DataMapBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DataMapViewport = { x: number; y: number; zoom: number };

/** Breathing room added around the graph when sizing the canvas box. */
export const DATA_MAP_MARGIN = 16;

/**
 * Framing limits. The PANE's zoom ceiling is deliberately ABOVE the framing's,
 * so a reader can zoom in past a fit with the controls. The floors are equal —
 * a fit is already the whole graph, so there is nothing below it to reach —
 * and the framing clamps to the pane's own minimum rather than a lower one.
 *
 * `FIT_MAX_ZOOM` has a second consumer: the screen caps the canvas box at
 * `extent.w * FIT_MAX_ZOOM`, because past that width the fit stops magnifying
 * and the box would only add empty space. One definition, so the cap and the
 * ceiling cannot drift apart.
 */
export const DATA_MAP_PANE_MIN_ZOOM = 0.12;
export const DATA_MAP_PANE_MAX_ZOOM = 2;
export const DATA_MAP_FIT_PADDING = 0.03;
export const DATA_MAP_FIT_MAX_ZOOM = 1.15;
export const DATA_MAP_FOCUS_PADDING = 0.15;
export const DATA_MAP_FOCUS_MAX_ZOOM = 1;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi);

/** The union box of any set of manifest boxes. `null` for an empty set. */
export const dataMapBounds = (boxes: DataMapBox[]): DataMapBounds | null => {
  if (!boxes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/**
 * The whole graph's bounds — tiers AND nodes. The tier frames enclose their
 * own nodes today, but the union is what makes that an observation rather
 * than an assumption the framing silently depends on.
 */
export const dataMapGraphBounds = (
  manifest: Pick<DataMapManifest, "tiers" | "nodes">,
): DataMapBounds | null =>
  dataMapBounds([...manifest.tiers, ...manifest.nodes]);

/**
 * Canvas size for the graph, margin included. The screen drives the canvas
 * box's `aspect-ratio` from this.
 *
 * Anchored at the ORIGIN, not at `bounds.x/y`: the flow pane's coordinate
 * space starts at 0, so any leading whitespace is part of the box. That makes
 * this and `viewportForBounds` — which sizes on the graph's OWN extent — the
 * same rectangle only while the layout's origin is 0. ELK emits minX = minY =
 * 0 today (verified against data/data_map.json); the two functions share their
 * BOUNDS rather than their measurement, so a non-zero origin would size the
 * box for the whitespace as well and shrink every fit proportionally.
 */
export const dataMapExtent = (
  manifest: Pick<DataMapManifest, "tiers" | "nodes">,
): { w: number; h: number } => {
  const bounds = dataMapGraphBounds(manifest);
  if (!bounds) return { w: 1, h: 1 };
  return {
    w: bounds.x + bounds.width + DATA_MAP_MARGIN,
    h: bounds.y + bounds.height + DATA_MAP_MARGIN,
  };
};

/**
 * The transform that centres `bounds` inside a `width` x `height` pane.
 *
 * Mirrors React Flow's `getViewportForBounds` FOR THE PARAMETER SHAPE this
 * canvas uses: a single NUMERIC padding, symmetric on both axes. Verified
 * against @xyflow/system 0.0.77 — max divergence 0.7px in y and 0.0004 in
 * zoom, from upstream's `Math.floor` on the resolved pixel padding.
 * Deliberately NOT mirrored: string ("20px" / "10%") and per-side object
 * paddings, and the post-centring `offset` correction, which is a no-op for a
 * symmetric numeric padding and nothing else. The parity is a real dependency
 * rather than a coincidence — v11's `width / (bounds.width * (1 + padding))`
 * became v12's `(width - p.x) / bounds.width`, and the two agree only because
 * `parsePadding` back-compats a numeric padding — so viewport.test.ts pins it
 * instead of this comment asserting it.
 *
 * Returns `null` when the pane has not been measured yet (width or height 0),
 * which is the state error #004 reports — the caller keeps the current
 * viewport instead of centring on a zero-sized pane.
 */
export const viewportForBounds = (
  bounds: DataMapBounds,
  width: number,
  height: number,
  opts: { padding: number; minZoom: number; maxZoom: number },
): DataMapViewport | null => {
  if (width <= 0 || height <= 0) return null;
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const { padding, minZoom, maxZoom } = opts;
  const xZoom = width / (bounds.width * (1 + padding));
  const yZoom = height / (bounds.height * (1 + padding));
  const zoom = clamp(Math.min(xZoom, yZoom), minZoom, maxZoom);
  return {
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  };
};
