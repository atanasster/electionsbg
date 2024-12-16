import { NavigateParams, useNavigateParams } from "@/ux/useNavigateParams";
import { FeatureMap } from "./FeatureMap";
import { usePartyInfo } from "@/data/usePartyInfo";
import { PartyVotesXS } from "../PartyVotesXS";
import { useTranslation } from "react-i18next";
import {
  GeoJSONFeature,
  GeoJSONProps,
} from "@/screens/components/maps/mapTypes";
import { ReactNode } from "react";
import { LocationInfo, Votes } from "@/data/dataTypes";

export function MapElement<DType extends GeoJSONProps>({
  feature,
  geoPath,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  onTouchEnd,
  info,
  votes,
  onClick,
}: {
  feature: GeoJSONFeature<DType>;
  geoPath: d3.GeoPath;
  votes?: Votes[];
  info?: LocationInfo;
  onMouseEnter: (
    e: React.MouseEvent<SVGElement, MouseEvent>,
    content: ReactNode,
  ) => void;
  onMouseMove: (e: React.MouseEvent<SVGElement, MouseEvent>) => void;
  onMouseLeave: () => void;
  onTouchEnd: (e: React.TouchEvent<SVGPathElement>) => void;
  onClick: (props: DType) => NavigateParams;
}) {
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
            e,
            info ? (
              <div className="text-left">
                <div className="text-lg text-center pb-2">{`${i18n.language === "bg" ? info.long_name || info.name : info.long_name_en || info.name_en}`}</div>
                {!!votes && <PartyVotesXS votes={votes} />}
              </div>
            ) : null,
          );
        }}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onTouchEnd={onTouchEnd}
        onClick={() => navigate(onClick(props))}
      />
    </>
  );
}
