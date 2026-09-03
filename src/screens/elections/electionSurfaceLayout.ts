// The canvas's LAYOUT, in one place, because the skeleton and the content must declare the same
// one (Phase 2 item 5).
//
// ⚠ "NO LAYOUT SHIFT WHEN THE MAP ARRIVES" IS ONLY TRUE IF THE TWO SHARE A DEFINITION. A
// skeleton that hand-copies the grid is correct on the day it is written and drifts the first
// time a column ratio moves — and the drift is invisible in review, because both files still
// read like a two-column grid. Shared constants make the two impossible to disagree.
//
// ⚠ AND jsdom CANNOT CHECK THE VISUAL CLAIM. It has no layout, so nothing here measures a
// shift; what the unit gates can hold is that both sides declare the same classes and the same
// slot ORDER. The pixel claim belongs to the browser suite (§10.0).

/** The canvas grid: one column on mobile, ranked-beside-map at `lg`. */
export const CANVAS_GRID_CLASS =
  "grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]";

/** ⚠ GRID PLACEMENT, NOT `order`. The ranked result is FIRST in the DOM and stays first on
 *  mobile; at `lg` the map is placed into column 1 and the list into column 2, so the visual
 *  arrangement changes without the reading order changing. */
export const CANVAS_RANKED_SLOT_CLASS = "lg:col-start-2 lg:row-start-1";
export const CANVAS_MAP_SLOT_CLASS = "lg:col-start-1 lg:row-start-1";

/** The skeleton's map box. A fixed height is the whole point: an `aspect-` box collapses to
 *  nothing before the map's own dimensions exist, which is the shift this is here to avoid. */
export const SKELETON_MAP_HEIGHT_CLASS = "h-[320px]";

/** One skeleton row per ranked row the preview can hold, so the list does not grow when the
 *  real one arrives. Read from the producer's own cap rather than guessed. */
export const SKELETON_ROW_HEIGHT_CLASS = "h-6";
