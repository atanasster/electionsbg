// Pure bounds reducer for a [lat, lng] polyline — the bounding box a route map
// fits its view to. Kept out of the map component file so it is unit-tested
// without a DOM and doesn't break the component file's Fast Refresh.

import type { LatLngBoundsExpression } from "leaflet";

/** The bounding box of a [lat, lng] route, or null for a line too short to draw
 *  (<2 points). */
export const routeBounds = (
  line: readonly [number, number][],
): LatLngBoundsExpression | null => {
  if (line.length < 2) return null;
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const [lat, lng] of line) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
};
