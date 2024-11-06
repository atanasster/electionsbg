/* eslint-disable @typescript-eslint/no-explicit-any */
import * as d3 from "d3";

import { Regions } from "../data/json_types";
import { RegionMap } from "./RegionMap";

const setMapProjection = (mapData: Regions) => {
  //- use the geoAlbers map projection
  const projection = d3.geoAlbers();

  projection
    .precision(0)
    .rotate([-25, 0])
    .fitExtent(
      [
        [0, 0],
        [960, 480],
      ],

      mapData as any,
    );
  return projection;
};

export const RegionsMap: React.FC<
  React.PropsWithChildren<{ regions: Regions }>
> = ({ regions }) => {
  const path = d3.geoPath().projection(setMapProjection(regions));
  const provincesList = regions.features.map((feature) => {
    const name = feature.properties.nuts3;
    return (
      <RegionMap
        key={feature.properties.nuts3}
        path={path}
        name={name}
        feature={feature}
      />
    );
  });

  return (
    <svg className="provinces" width={960} height={480}>
      <g>{provincesList}</g>
    </svg>
  );
};
