import * as d3 from "d3";
import { useNavigate, createSearchParams } from "react-router-dom";
import { useTooltip } from "@/ux/useTooltip";
import { Regions } from "../data/json_types";
import { RegionMap } from "./RegionMap";
import { getDataProjection } from "../utils/d3_utils";
import { useRegionVotes } from "@/data/useRegionVotes";
import { PartyVotesXS } from "./PartyVotesXS";
import { usePartyInfo } from "@/data/usePartyInfo";
import { useTranslation } from "react-i18next";
import { useRegions } from "@/data/useRegions";

export const RegionsMap: React.FC<
  React.PropsWithChildren<{ regions: Regions; size: [number, number] }>
> = ({ regions, size }) => {
  const navigate = useNavigate();
  const { findRegion } = useRegions();
  const { votesByRegion } = useRegionVotes();
  const { topVotesParty } = usePartyInfo();
  const { i18n } = useTranslation();

  const { onMouseEnter, onMouseMove, onMouseLeave, tooltip } = useTooltip();

  const path = getDataProjection(regions as d3.GeoPermissibleObjects, size);
  const provincesList = regions.features.map((feature) => {
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
