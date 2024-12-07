import * as d3 from "d3";
import { GeoJSONProps, GeoJSONMap as GeoJSONMapType } from "@/data/mapTypes";
import { FeatureMap } from "./FeatureMap";
import { usePartyInfo } from "@/data/usePartyInfo";
import { useTranslation } from "react-i18next";

import { ReactNode, useMemo } from "react";
import { MapCoordinates } from "@/layout/MapLayout";
import { geoDataCenter, getDataProjection } from "@/screens/utils/d3_utils";
import { PartyVotesXS } from "../PartyVotesXS";
import { LocationInfo, Votes } from "@/data/dataTypes";
import { useTooltip } from "@/ux/useTooltip";

export const GeoJSONMap = <Props extends GeoJSONProps>({
  mapJSON,
  size,
  children,
  findInfo,
  findVotes,
  getName,
  onClick,
}: {
  mapJSON: GeoJSONMapType<Props>;
  size: MapCoordinates;
  children: ReactNode;
  findInfo: (p: Props) => LocationInfo | undefined;
  findVotes: (p: Props) => Votes[] | undefined;
  onClick: (p: Props) => void;
  getName: (p: Props) => string;
}) => {
  const { topVotesParty } = usePartyInfo();
  const { i18n } = useTranslation();
  const { onMouseEnter, onMouseMove, onMouseLeave, onTouchEnd, tooltip } =
    useTooltip();
  const { path, projection } = getDataProjection(
    mapJSON as d3.GeoPermissibleObjects,
    size,
  );
  const components = useMemo(
    () =>
      mapJSON.features.reduce(
        (acc: { maps: ReactNode[]; labels: ReactNode[] }, feature) => {
          const info = findInfo(feature.properties);
          const votes = findVotes(feature.properties);
          const name = getName(feature.properties);
          const party = topVotesParty(votes);
          const { ptLB, ptRT } = geoDataCenter(
            projection,
            feature as d3.GeoPermissibleObjects,
          );
          return {
            maps: [
              ...acc.maps,
              <FeatureMap
                key={`map-${name}`}
                geoPath={path}
                name={name}
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
                    ) : (
                      name
                    ),
                  );
                }}
                onMouseMove={onMouseMove}
                onMouseLeave={onMouseLeave}
                onTouchEnd={onTouchEnd}
                onClick={() => onClick(feature.properties)}
              />,
            ],
            labels: [
              ...acc.labels,
              ptLB && ptRT && info ? (
                <text
                  key={`label-${name}`}
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
              ) : null,
            ],
          };
        },
        {
          maps: [],
          labels: [],
        },
      ),
    [
      findInfo,
      findVotes,
      getName,
      i18n.language,
      mapJSON.features,
      onClick,
      onMouseEnter,
      onMouseLeave,
      onMouseMove,
      onTouchEnd,
      path,
      projection,
      topVotesParty,
    ],
  );
  return (
    <div>
      <svg className="overflow-hidden" width={size[0]} height={size[1]}>
        <g>{components.maps}</g>
        {components.labels}
      </svg>
      {children}
      {tooltip}
    </div>
  );
};
