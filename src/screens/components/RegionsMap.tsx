import * as d3 from "d3";
import { useNavigate, createSearchParams } from "react-router-dom";
import { useTooltip } from "@/ux/useTooltip";
import { Regions } from "../data/json_types";
import { RegionMap } from "./RegionMap";
import { getDataProjection } from "../utils/d3_utils";
import { useSettlementsInfo } from "@/data/SettlementsContext";
import { useAggregatedVotes } from "@/data/AggregatedVotesHook";
import { PartyVotesXS } from "./PartyVotesXS";

export const RegionsMap: React.FC<
  React.PropsWithChildren<{ regions: Regions; size: [number, number] }>
> = ({ regions, size }) => {
  const navigate = useNavigate();
  const { findRegion } = useSettlementsInfo();
  const { votesByRegion } = useAggregatedVotes();
  const { onMouseEnter, onMouseMove, onMouseLeave, tooltip } = useTooltip();

  const path = getDataProjection(regions as d3.GeoPermissibleObjects, size);
  const provincesList = regions.features.map((feature) => {
    const name = feature.properties.nuts3;
    return (
      <RegionMap
        key={feature.properties.nuts3}
        path={path}
        name={name}
        feature={feature}
        onMouseEnter={(e) => {
          const info = findRegion(name);
          const regionVotes = (info && votesByRegion(info.nuts3)) || null;
          onMouseEnter(
            e,
            info ? (
              <div className="text-left">
                <div>{`${info.name}/${info.name_en}`}</div>
                <div>{`name:${info.full_name_bul}`}</div>
                <div>{`ekatte:${info.ekatte}`}</div>
                <div>{`code:${info.nuts3}`}</div>
                <PartyVotesXS votes={regionVotes?.votes} />
              </div>
            ) : (
              name
            ),
          );
        }}
        onMouseMove={(e) => {
          onMouseMove(e);
        }}
        onMouseLeave={() => {
          onMouseLeave();
        }}
        onClick={() => {
          navigate({
            pathname: "/municipality",
            search: createSearchParams({
              region: name,
            }).toString(),
          });
        }}
      />
    );
  });

  return (
    <div>
      <svg width={size[0]} height={size[1]}>
        <g>{provincesList}</g>
      </svg>
      {tooltip}
    </div>
  );
};
