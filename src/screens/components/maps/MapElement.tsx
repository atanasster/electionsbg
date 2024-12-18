import { NavigateParams, useNavigateParams } from "@/ux/useNavigateParams";
import { FeatureMap } from "./FeatureMap";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { PartyVotesXS } from "../PartyVotesXS";
import { useTranslation } from "react-i18next";
import {
  GeoJSONFeature,
  GeoJSONProps,
} from "@/screens/components/maps/mapTypes";
import { LocationInfo, Votes } from "@/data/dataTypes";
import { TooltipEvents } from "@/ux/useTooltip";

export function MapElement<DType extends GeoJSONProps>({
  feature,
  geoPath,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  info,
  votes,
  onClick,
}: {
  feature: GeoJSONFeature<DType>;
  geoPath: d3.GeoPath;
  votes?: Votes[];
  info?: LocationInfo;
  onClick: (props: DType) => NavigateParams;
} & TooltipEvents) {
  const { properties: props } = feature;
  const navigate = useNavigateParams();
  const { i18n } = useTranslation();
  const { topVotesParty } = usePartyInfo();
  const party = topVotesParty(votes);

  return (
    <>
      <FeatureMap
        geoPath={geoPath}
        fillColor={party?.color}
        feature={feature}
        onMouseEnter={(e) => {
          onMouseEnter(
            { pageX: e.pageX, pageY: e.pageY },
            info ? (
              <div className="text-left">
                <div className="text-lg text-center pb-1">{`${i18n.language === "bg" ? info.long_name || info.name : info.long_name_en || info.name_en}`}</div>
                {!!votes && <PartyVotesXS votes={votes} />}
              </div>
            ) : null,
          );
        }}
        onMouseMove={(e) => onMouseMove({ pageX: e.pageX, pageY: e.pageY })}
        onMouseLeave={onMouseLeave}
        onClick={() => navigate(onClick(props))}
      />
    </>
  );
}
