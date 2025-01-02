import { MapCoordinates } from "@/layout/dataview/MapLayout";
import * as d3 from "d3";

export const getDataProjection = (
  data: d3.GeoPermissibleObjects,
  size: MapCoordinates,
) => {
  const draftProjection = d3.geoMercator().scale(1);
  // create the path
  const draftPath = d3.geoPath().projection(draftProjection);
  const draftBounds = draftPath.bounds(data);
  const scale =
    0.95 /
    Math.max(
      (draftBounds[1][0] - draftBounds[0][0]) / size[0],
      (draftBounds[1][1] - draftBounds[0][1]) / size[1],
    );
  const bounds = d3.geoBounds(data);
  const center: [number, number] = [
    (bounds[1][0] + bounds[0][0]) / 2,
    (bounds[1][1] + bounds[0][1]) / 2,
  ];

  const projection = d3
    .geoMercator()
    .center(center)
    .scale(scale)
    .translate([size[0] / 2, size[1] / 2]);
  const path = draftPath.projection(projection);

  return { path, projection, bounds, scale };
};

export const geoDataCenter = (
  projection: d3.GeoProjection,
  data: d3.GeoPermissibleObjects,
) => {
  const bounds = d3.geoBounds(data);
  const ptLB = projection(bounds[0]);
  const ptRT = projection(bounds[1]);
  return { ptLB, ptRT };
};

export const zoomFromScale = (scale: number) =>
  Math.log(scale * 2 * Math.PI) / Math.LN2 - 8;

export const scaleFromZoom = (zoomLevel: number) =>
  Math.pow(2, 8 + zoomLevel) / 2 / Math.PI;
