import { MapCoordinates } from "@/layout/MapLayout";
import * as d3 from "d3";

export const getDataProjection = (
  data: d3.GeoPermissibleObjects,
  size: MapCoordinates,
) => {
  const draftProjection = d3.geoMercator().scale(1);
  // create the path
  const draftPath = d3.geoPath().projection(draftProjection);
  // const path = d3.geoPath().projection(setMapProjection(municipalities));
  const bounds = draftPath.bounds(data);
  const scale =
    0.95 /
    Math.max(
      (bounds[1][0] - bounds[0][0]) / size[0],
      (bounds[1][1] - bounds[0][1]) / size[1],
    );
  const geoBounds = d3.geoBounds(data);
  const center: [number, number] = [
    (geoBounds[1][0] + geoBounds[0][0]) / 2,
    (geoBounds[1][1] + geoBounds[0][1]) / 2,
  ];

  const projection = d3
    .geoMercator()
    .center(center)
    .scale(scale)
    .translate([size[0] / 2, size[1] / 2]);
  const path = draftPath.projection(projection);

  return { path, projection };
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
