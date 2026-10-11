// The map drill-down camera: before navigating into a region, the map flies into it.
//
// Pure geometry, kept apart from the hook so it is testable without a DOM: given the clicked
// region's bounding box in the map's own pixel frame, the transform that brings it to the
// middle of the frame at the size it is about to be drawn at on the next page.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Never magnify past this: the basemap tiles under the SVG are raster, and at 6× a tile is a
 *  blur rather than a place. The page that follows draws the region sharp anyway. */
export const MAX_DRILL_SCALE = 4;
/** Leave a margin round the region, as the next page's fit does. */
const FILL = 0.85;

/** CSS transform (with `transform-origin: 0 0`) that centres `box` in a `width × height`
 *  frame, as large as fits. Null for a degenerate box, which callers treat as „just navigate". */
export const drillTransform = (
  box: Box,
  width: number,
  height: number,
): string | null => {
  if (!(box.width > 0 && box.height > 0 && width > 0 && height > 0))
    return null;
  const scale = Math.min(
    MAX_DRILL_SCALE,
    FILL * Math.min(width / box.width, height / box.height),
  );
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const tx = width / 2 - scale * cx;
  const ty = height / 2 - scale * cy;
  const r = (n: number) => Math.round(n * 100) / 100;
  return `translate(${r(tx)}px, ${r(ty)}px) scale(${r(scale)})`;
};
