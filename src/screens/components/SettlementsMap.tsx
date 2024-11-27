import * as d3 from "d3";

import { useMemo } from "react";
import { useNavigate, createSearchParams } from "react-router-dom";

import { RegionMap } from "./RegionMap";
import { geoDataCenter, getDataProjection } from "../utils/d3_utils";
import { useTooltip } from "@/ux/useTooltip";
import {
  useSettlementsInfo,
  RegionInfo,
  MunicipalityInfo,
} from "@/data/useSettlements";
import { PartyVotesXS } from "./PartyVotesXS";
import { useSettlementVotes } from "@/data/useSettlementVotes";
import { usePartyInfo } from "@/data/usePartyInfo";
import { useTranslation } from "react-i18next";
import { SettlementGeoJSON } from "@/data/mapTypes";

export const SettlementsMap: React.FC<
  React.PropsWithChildren<{
    settlements: SettlementGeoJSON;
    municipality: MunicipalityInfo;
    region: RegionInfo;
    size: [number, number];
  }>
> = ({ settlements: data, region, municipality, size }) => {
  const { onMouseEnter, onMouseMove, onMouseLeave, tooltip } = useTooltip();
  const navigate = useNavigate();
  const { findSettlement } = useSettlementsInfo();
  const { votesBySettlement } = useSettlementVotes();
  const { topVotesParty } = usePartyInfo();
  const { i18n } = useTranslation();
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

  const { path, projection } = getDataProjection(
    settlements as d3.GeoPermissibleObjects,
    size,
  );
  const municipalitiesList = settlements.features.map((feature) => {
    const name = feature.properties.ekatte;
    const s = findSettlement(name);
    const votes = s && votesBySettlement(name);
    const party = topVotesParty(votes?.results.votes);

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
          const settlementVotes = info && votesBySettlement(info.ekatte);
          onMouseEnter(
            e,
            info ? (
              <div className="text-left">
                <div className="text-lg text-center pb-2">
                  {i18n.language === "bg"
                    ? `${info.t_v_m} ${info.name}`
                    : info.name_en}
                </div>
                {!!settlementVotes?.results.votes && (
                  <PartyVotesXS votes={settlementVotes?.results.votes} />
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
        onClick={() => {
          if (votes?.sections.length) {
            navigate({
              pathname: "/sections",
              search: createSearchParams({
                region: region.oblast,
                municipality: municipality.obshtina,
                settlement: name,
              }).toString(),
            });
          }
        }}
        onCursor={() => (votes?.sections.length ? "pointer" : "default")}
      />
    );
  });

  const settlementsNames = useMemo(
    () =>
      settlements.features.map((feature) => {
        const name = feature.properties.ekatte;
        const { ptLB, ptRT } = geoDataCenter(
          projection,
          feature as d3.GeoPermissibleObjects,
        );
        const info = findSettlement(name);

        return ptLB && ptRT && info ? (
          <text
            key={
              feature.properties.nuts3 +
              feature.properties.nuts4 +
              feature.properties.ekatte
            }
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
            {i18n.language === "bg"
              ? `${info.t_v_m} ${info.name}`
              : info.name_en}
          </text>
        ) : null;
      }),
    [findSettlement, i18n.language, projection, settlements.features],
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
        {settlementsNames}
      </svg>
      {tooltip}
    </div>
  );
};
