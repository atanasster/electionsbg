import * as d3 from "d3";
import { useMemo } from "react";
import { RegionMap } from "./RegionMap";
import { geoDataCenter, getDataProjection } from "../utils/d3_utils";
import { useTooltip } from "@/ux/useTooltip";
import { PartyVotesXS } from "./PartyVotesXS";
import { useMunicipalitydVotes } from "@/data/useMunicipalityVotes";
import { usePartyInfo } from "@/data/usePartyInfo";
import { useTranslation } from "react-i18next";
import { useMunicipalities } from "@/data/useMunicipalities";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { MapCoordinates } from "@/layout/MapLayout";
import { useMunicipalitiesMap } from "@/data/useMunicipalitiesMap";

export const MunicipalitiesMap: React.FC<
  React.PropsWithChildren<{
    region: string;
    size: MapCoordinates;
  }>
> = ({ region, size }) => {
  const { onMouseEnter, onMouseMove, onMouseLeave, tooltip } = useTooltip();
  const navigate = useNavigateParams();
  const { findMunicipality } = useMunicipalities();
  const { votesByMunicipality } = useMunicipalitydVotes();
  const { topVotesParty } = usePartyInfo();
  const { i18n } = useTranslation();
  const municipalities = useMunicipalitiesMap(region);

  const { path, projection } = getDataProjection(
    municipalities as d3.GeoPermissibleObjects,
    size,
  );
  const municipalitiesList = useMemo(
    () =>
      municipalities?.features.map((feature) => {
        const name = feature.properties.nuts4;
        const votes = votesByMunicipality(name);
        const party = topVotesParty(votes?.results.votes);

        return (
          <RegionMap
            key={feature.properties.nuts3 + feature.properties.nuts4}
            path={path}
            name={name}
            fillColor={party?.color}
            feature={feature}
            onClick={() => {
              navigate({
                pathname: "/settlement",
                search: {
                  region,
                  municipality: name,
                },
              });
            }}
            onMouseEnter={(e) => {
              const info = findMunicipality(name);
              const muniVotes = info && votesByMunicipality(info.obshtina);
              onMouseEnter(
                e,
                info ? (
                  <div className="text-left">
                    <div className="text-lg text-center pb-2">{`${i18n.language === "bg" ? info.name : info.name_en}`}</div>
                    {!!muniVotes?.results.votes && (
                      <PartyVotesXS votes={muniVotes?.results.votes} />
                    )}
                  </div>
                ) : (
                  `${region}-${name}`
                ),
              );
            }}
            onMouseMove={(e) => {
              onMouseMove(e);
            }}
            onMouseLeave={() => {
              onMouseLeave();
            }}
          />
        );
      }),
    [
      findMunicipality,
      i18n.language,
      municipalities?.features,
      navigate,
      onMouseEnter,
      onMouseLeave,
      onMouseMove,
      path,
      region,
      topVotesParty,
      votesByMunicipality,
    ],
  );
  const municipalitiesNames = useMemo(
    () =>
      municipalities?.features.map((feature) => {
        const name = feature.properties.nuts4;
        const { ptLB, ptRT } = geoDataCenter(
          projection,
          feature as d3.GeoPermissibleObjects,
        );
        const info = findMunicipality(name);

        return ptLB && ptRT && info ? (
          <text
            key={feature.properties.nuts3 + feature.properties.nuts4}
            className="fill-white"
            textAnchor="middle"
            fontSize="small"
            style={{ pointerEvents: "none" }}
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
    [findMunicipality, i18n.language, municipalities?.features, projection],
  );
  return (
    <div>
      <svg
        className="municipalities border-slate-200"
        width={size[0]}
        height={size[1]}
        overflow="visible"
      >
        <g>{municipalitiesList}</g>
        {municipalitiesNames}
      </svg>
      {tooltip}
    </div>
  );
};
