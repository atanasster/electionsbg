import * as d3 from "d3";

import { useMemo } from "react";
import { useNavigate, createSearchParams } from "react-router-dom";

import { Settlements } from "../data/json_types";
import { RegionMap } from "./RegionMap";
import { Link } from "@/ux/Link";
import { getDataProjection } from "../utils/d3_utils";
import { useTooltip } from "@/ux/useTooltip";
import {
  useSettlementsInfo,
  RegionInfo,
  MunicipalityInfo,
} from "@/data/SettlementsContext";
import { PartyVotesXS } from "./PartyVotesXS";
import { useAggregatedVotes } from "@/data/AggregatedVotesHook";
import { useElectionInfo } from "@/data/ElectionsContext";

export const SettlementsMap: React.FC<
  React.PropsWithChildren<{
    settlements: Settlements;
    municipality: MunicipalityInfo;
    region: RegionInfo;
    size: [number, number];
  }>
> = ({ settlements: data, region, municipality, size }) => {
  const { onMouseEnter, onMouseMove, onMouseLeave, tooltip } = useTooltip();
  const navigate = useNavigate();
  const { findSettlement } = useSettlementsInfo();
  const { votesBySettlement } = useAggregatedVotes();
  const { topVotesParty } = useElectionInfo();
  const settlements = useMemo(() => {
    return {
      ...data,
      features: data.features.filter((feature) => {
        return (
          feature.properties.nuts3 === region.oblast &&
          feature.properties.nuts4 === municipality.obshtina
        );
      }),
    };
  }, [data, region, municipality]);

  const path = getDataProjection(settlements as d3.GeoPermissibleObjects, size);
  const municipalitiesList = settlements.features.map((feature) => {
    const name = feature.properties.ekatte;
    const s = findSettlement(name);
    const votes = s && votesBySettlement(s.oblast, s.obshtina, name);
    const party = topVotesParty(votes?.votes);

    return (
      <RegionMap
        key={
          feature.properties.nuts3 +
          feature.properties.nuts4 +
          feature.properties.ekatte
        }
        path={path}
        name={name}
        fillColor={party?.color}
        feature={feature}
        onMouseEnter={(e) => {
          const info = findSettlement(name);
          const settlementVotes =
            info && votesBySettlement(info.oblast, info.obshtina, info.ekatte);
          onMouseEnter(
            e,
            info ? (
              <div className="text-left">
                <div>{`${info.t_v_m} ${info.name}/${info.name_en}`}</div>
                <div>{`region:${info.oblast} - ${info.oblast_name}`}</div>
                <div>{`municipality:${info.obshtina} - ${info.obshtina_name}`}</div>
                <div>{`ekatte:${info.ekatte}`}</div>
                <div>{`altitude:${info.text}`}</div>
                <PartyVotesXS votes={settlementVotes?.votes} />
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
        onClick={() => {
          navigate({
            pathname: "/sections",
            search: createSearchParams({
              region: region.oblast,
              municipality: municipality.obshtina,
              settlement: name,
            }).toString(),
          });
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
              region: region.oblast,
            }).toString(),
          });
        }}
      >
        {`Back to region ${region.name}`}
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
