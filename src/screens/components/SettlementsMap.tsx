import * as d3 from "d3";

import { useMemo } from "react";
import { useNavigate, createSearchParams } from "react-router-dom";

import { Settlements } from "../data/json_types";
import { RegionMap } from "./RegionMap";
import { Link } from "@/ux/Link";
import { getDataProjection } from "../utils/d3_utils";
import { useTooltip } from "@/ux/useTooltip";

export const SettlementsMap: React.FC<
  React.PropsWithChildren<{
    settlements: Settlements;
    settlement: string;
    region: string;
    size: [number, number];
  }>
> = ({ settlements: data, region, settlement, size }) => {
  const { onMouseEnter, onMouseMove, onMouseLeave, tooltip } = useTooltip();
  const navigate = useNavigate();
  const settlements = useMemo(() => {
    return {
      ...data,
      features: data.features.filter((feature) => {
        return (
          feature.properties.nuts3 === region &&
          feature.properties.nuts4 === settlement
        );
      }),
    };
  }, [data, region, settlement]);

  const path = getDataProjection(settlements as d3.GeoPermissibleObjects, size);
  const municipalitiesList = settlements.features.map((feature) => {
    const name = feature.properties.ekatte;
    return (
      <RegionMap
        key={
          feature.properties.nuts3 +
          feature.properties.nuts4 +
          feature.properties.ekatte
        }
        path={path}
        name={name}
        feature={feature}
        onMouseEnter={(e) => {
          onMouseEnter(e, `${region}-${settlement}-${name}`);
        }}
        onMouseMove={(e) => {
          onMouseMove(e);
        }}
        onMouseLeave={() => {
          onMouseLeave();
        }}
      />
    );
  });

  return (
    <div>
      <Link
        aria-label="Go to back to region"
        onClick={() => {
          navigate({
            pathname: "/municipality",
            search: createSearchParams({
              region,
            }).toString(),
          });
        }}
      >
        {`Back to region ${region}`}
      </Link>
      <svg
        className="municipalities border-slate-200"
        width={size[0]}
        height={size[1]}
        overflow="visible"
      >
        <g>{municipalitiesList}</g>
      </svg>
      {tooltip}
    </div>
  );
};
