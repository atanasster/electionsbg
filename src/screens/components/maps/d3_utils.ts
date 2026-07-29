// Import from d3-geo, not the `d3` umbrella — but NOT as a size fix. Rollup
// tree-shakes the umbrella's `export *` fine, so dropping it was byte-neutral
// (vendor-charts 556.37 -> 556.36 kB raw). The reasons that do hold:
//   (a) the meta package made d3-force / d3-delaunay / d3-geo resolvable
//       without ever being declared in package.json, and
//   (b) per-module ids are what let manualChunks give d3-geo its own chunk.
// Until that split lands, every /d3-/ id goes to vendor-charts (556 kB raw),
// so a map-only route still downloads all of recharts for three projection
// functions. See docs/plans/bundle-critical-path-v1.md (T3, T3.5).
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import {
  geoBounds,
  geoMercator,
  geoPath,
  type GeoPermissibleObjects,
  type GeoProjection,
} from "d3-geo";

export const getDataProjection = (
  data: GeoPermissibleObjects,
  size: MapCoordinates,
) => {
  const draftProjection = geoMercator().scale(1);
  // create the path
  const draftPath = geoPath().projection(draftProjection);
  const draftBounds = draftPath.bounds(data);
  const scale =
    0.95 /
    Math.max(
      (draftBounds[1][0] - draftBounds[0][0]) / size[0],
      (draftBounds[1][1] - draftBounds[0][1]) / size[1],
    );
  const bounds = geoBounds(data);
  const center: [number, number] = [
    (bounds[1][0] + bounds[0][0]) / 2,
    (bounds[1][1] + bounds[0][1]) / 2,
  ];

  const projection = geoMercator()
    .center(center)
    .scale(scale)
    .translate([size[0] / 2, size[1] / 2]);
  const path = draftPath.projection(projection);

  return { path, projection, bounds, scale };
};

export const geoDataCenter = (
  projection: GeoProjection,
  data: GeoPermissibleObjects,
) => {
  const bounds = geoBounds(data);
  const ptLB = projection(bounds[0]);
  const ptRT = projection(bounds[1]);
  return { ptLB, ptRT };
};

export const zoomFromScale = (scale: number) =>
  Math.log(scale * 2 * Math.PI) / Math.LN2 - 8;

export const scaleFromZoom = (zoomLevel: number) =>
  Math.pow(2, 8 + zoomLevel) / 2 / Math.PI;
