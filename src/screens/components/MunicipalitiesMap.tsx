import * as d3 from "d3";
import { useMemo } from "react";
import { useNavigate, createSearchParams } from "react-router-dom";

import { Municipalities } from "../data/json_types";
import { RegionMap } from "./RegionMap";
import { Link } from "@/ux/Link";
import { getDataProjection } from "../utils/d3_utils";
import { useTooltip } from "@/ux/useTooltip";
import { useSettlementsInfo } from "@/data/SettlementsContext";
import { PartyVotesXS } from "./PartyVotesXS";
import { useAggregatedVotes } from "@/data/AggregatedVotesHook";
import { useElectionInfo } from "@/data/ElectionsContext";

export const MunicipalitiesMap: React.FC<
  React.PropsWithChildren<{
    municipalities: Municipalities;
    region: string;
    size: [number, number];
  }>
> = ({ municipalities: data, region, size }) => {
  const { onMouseEnter, onMouseMove, onMouseLeave, tooltip } = useTooltip();
  const navigate = useNavigate();
  const { findMunicipality } = useSettlementsInfo();
  const { votesByMunicipality } = useAggregatedVotes();
  const { topVotesParty } = useElectionInfo();
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
  const municipalitiesList = municipalities.features.map((feature) => {
    const name = feature.properties.nuts4;
    const votes = votesByMunicipality(feature.properties.nuts3, name);
    const party = topVotesParty(votes?.votes);

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
            search: createSearchParams({
              region,
              municipality: name,
            }).toString(),
          });
        }}
        onMouseEnter={(e) => {
          const info = findMunicipality(name);
          const muniVotes =
            info &&
            votesByMunicipality(info.obshtina.slice(0, 3), info.obshtina);
          onMouseEnter(
            e,
            info ? (
              <div className="text-left">
                <div>{`${info.name}/${info.name_en}`}</div>
                <div>{`name:${info.full_name_bul}`}</div>
                <div>{`municipality:${info.obshtina}`}</div>
                <div>{`ekatte:${info.ekatte}`}</div>
                <PartyVotesXS votes={muniVotes?.votes} />
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
  });

  return (
    <div>
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
      {tooltip}
    </div>
  );
};
