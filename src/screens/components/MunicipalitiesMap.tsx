import * as d3 from "d3";

import { Municipalities } from "../data/json_types";
import { RegionMap } from "./RegionMap";
import { Link } from "@/ux/Link";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getDataProjection } from "../utils/d3_utils";

export const MunicipalitiesMap: React.FC<
  React.PropsWithChildren<{
    municipalities: Municipalities;
    region: string;
    size: [number, number];
  }>
> = ({ municipalities: data, region, size }) => {
  const navigate = useNavigate();
  const municipalities = useMemo(() => {
    return {
      ...data,
      features: data.features.filter((feature) => {
        return feature.properties.nuts3 === region;
      }),
    };
  }, [data, region]);

  const path = getDataProjection(
    municipalities as d3.GeoPermissibleObjects,
    size,
  );
  const municipalitiesList = municipalities.features
    .filter((feature) => {
      return feature.properties.nuts3 === region;
    })
    .map((feature) => {
      const name = feature.properties.nuts4;
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
    <>
      <Link
        aria-label="Go to full country map"
        onClick={() => {
          navigate("/");
        }}
      >
        Back to Country
      </Link>
      <svg
        className="municipalities border-slate-200"
        width={size[0]}
        height={size[1]}
        overflow="visible"
      >
        <g>{municipalitiesList}</g>
      </svg>
    </>
  );
};
