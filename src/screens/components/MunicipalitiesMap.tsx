/* eslint-disable @typescript-eslint/no-explicit-any */
import * as d3 from "d3";

import { Municipalities } from "../data/json_types";
import { RegionMap } from "./RegionMap";

const setMapProjection = (mapData: Municipalities) => {
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

export const MunicipalitiesMap: React.FC<
  React.PropsWithChildren<{ municipalities: Municipalities; region: string }>
> = ({ municipalities, region }) => {
  const path = d3.geoPath().projection(setMapProjection(municipalities));
  const provincesList = municipalities.features
    .filter((feature) => {
      return feature.properties.nuts3 === region;
    })
    .map((feature) => {
      const name = feature.properties.nuts3;
      return (
        <RegionMap
          key={feature.properties.nuts3 + feature.properties.nuts4}
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
