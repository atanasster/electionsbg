import * as d3 from "d3";
import { useNavigate, createSearchParams } from "react-router-dom";
import { useTooltip } from "@/ux/useTooltip";
import { RegionGeoJSON } from "@/data/mapTypes";
import { RegionMap } from "./RegionMap";
import { geoDataCenter, getDataProjection } from "../utils/d3_utils";
import { useRegionVotes } from "@/data/useRegionVotes";
import { PartyVotesXS } from "./PartyVotesXS";
import { usePartyInfo } from "@/data/usePartyInfo";
import { useTranslation } from "react-i18next";
import { useRegions } from "@/data/useRegions";

import { useMemo } from "react";

export const RegionsMap: React.FC<
  React.PropsWithChildren<{ regions: RegionGeoJSON; size: [number, number] }>
> = ({ regions, size }) => {
  const navigate = useNavigate();
  const { topVotesParty } = usePartyInfo();
  const { findRegion } = useRegions();
  const { votesByRegion } = useRegionVotes();
  const { i18n } = useTranslation();

  const { onMouseEnter, onMouseMove, onMouseLeave, tooltip } = useTooltip();

  const { path, projection } = getDataProjection(
    regions as d3.GeoPermissibleObjects,
    size,
  );
  const regionsList = useMemo(
    () =>
      regions.features.map((feature) => {
        const name = feature.properties.nuts3;
        const votes = votesByRegion(name);
        const party = topVotesParty(votes?.results.votes);

        return (
          <RegionMap
            key={feature.properties.nuts3}
            path={path}
            name={name}
            fillColor={party?.color}
            feature={feature}
            onMouseEnter={(e) => {
              const info = findRegion(name);
              const regionVotes = (info && votesByRegion(info.oblast)) || null;
              onMouseEnter(
                e,
                info ? (
                  <div className="text-left">
                    <div className="text-lg text-center pb-2">{`${i18n.language === "bg" ? info.name : info.name_en}`}</div>
                    {!!regionVotes?.results.votes && (
                      <PartyVotesXS votes={regionVotes?.results.votes} />
                    )}
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
      }),
    [
      findRegion,
      i18n.language,
      navigate,
      onMouseEnter,
      onMouseLeave,
      onMouseMove,
      path,
      regions.features,
      topVotesParty,
      votesByRegion,
    ],
  );
  const regionsNames = useMemo(
    () =>
      regions.features.map((feature) => {
        const name = feature.properties.nuts3;
        const { ptLB, ptRT } = geoDataCenter(
          projection,
          feature as d3.GeoPermissibleObjects,
        );
        const info = findRegion(name);
        return ptLB && ptRT && info ? (
          <text
            key={feature.properties.nuts3}
            className="fill-white"
            style={{ pointerEvents: "none" }}
            textAnchor="middle"
            fontSize="small"
            x={
              info.dx
                ? ptLB[0] + (ptRT[0] - ptLB[0]) * parseFloat(info.dx)
                : ptLB[0] + (ptRT[0] - ptLB[0]) / 2
            }
            y={
              info.dy
                ? ptLB[1] + (ptRT[1] - ptLB[1]) * parseFloat(info.dy)
                : ptLB[1] + (ptRT[1] - ptLB[1]) / 2
            }
          >
            {`${i18n.language === "bg" ? info.name : info.name_en}`}
          </text>
        ) : null;
      }),
    [findRegion, i18n.language, projection, regions.features],
  );
  return (
    <div>
      <svg width={size[0]} height={size[1]}>
        <g>{regionsList}</g>
        {regionsNames}
        {/*         <circle
          className="stroke-muted-foreground"
          cx={ptBurgas?.[0]}
          cy={ptBurgas?.[1]}
          r={5}
          strokeWidth="2"
          fill="none"
        />
 */}{" "}
      </svg>
      {tooltip}
    </div>
  );
};
