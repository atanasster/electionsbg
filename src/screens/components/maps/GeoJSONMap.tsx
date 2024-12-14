import * as d3 from "d3";
import { GeoJSONProps, GeoJSONMap as GeoJSONMapType } from "@/data/mapTypes";

import { FeatureMap } from "./FeatureMap";
import { usePartyInfo } from "@/data/usePartyInfo";
import { useTranslation } from "react-i18next";

import { ReactNode, useMemo } from "react";
import { MapCoordinates } from "@/layout/MapLayout";
import { geoDataCenter, getDataProjection } from "@/screens/utils/d3_utils";
import { PartyVotesXS } from "../PartyVotesXS";
import { LocationInfo, PartyVotes, Votes } from "@/data/dataTypes";
import { useTooltip } from "@/ux/useTooltip";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";

const MapPin = ({
  projection,
  x,
  y,
  scale = 3,
}: {
  projection: d3.GeoProjection;
  x: number;
  y: number;
  scale?: number;
}) => {
  const p = projection([x, y]);
  if (p) {
    const sc = Math.min(1.8, Math.max(0.4, scale));
    return (
      <g
        className="pointer-events-none"
        transform={`translate(${p[0] - (16 * scale) / 2}, ${p[1] - (24 * scale) / 2}) scale(${sc})`}
      >
        <path
          d="m12 0c-4.4183 2.3685e-15 -8 3.5817-8 8 0 1.421 0.3816 2.75 1.0312 3.906 0.1079 0.192 0.221 0.381 0.3438 0.563l6.625 11.531 6.625-11.531c0.102-0.151 0.19-0.311 0.281-0.469l0.063-0.094c0.649-1.156 1.031-2.485 1.031-3.906 0-4.4183-3.582-8-8-8zm0 4c2.209 0 4 1.7909 4 4 0 2.209-1.791 4-4 4-2.2091 0-4-1.791-4-4 0-2.2091 1.7909-4 4-4z"
          fill="#e74c3c"
        />
        <path
          d="m12 3c-2.7614 0-5 2.2386-5 5 0 2.761 2.2386 5 5 5 2.761 0 5-2.239 5-5 0-2.7614-2.239-5-5-5zm0 2c1.657 0 3 1.3431 3 3s-1.343 3-3 3-3-1.3431-3-3 1.343-3 3-3z"
          fill="#c0392b"
        />
      </g>
    );
  }
  return null;
};
export const GeoJSONMap = <Props extends GeoJSONProps>({
  mapJSON,
  size,
  children,
  findInfo,
  findVotes,
  getName,
  onClick,
  withNames,
}: {
  mapJSON: GeoJSONMapType<Props>;
  size: MapCoordinates;
  children: ReactNode;
  withNames: boolean;
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
  const isXSmall = useMediaQueryMatch("xs");
  const components = useMemo(
    () =>
      mapJSON.features.reduce(
        (
          acc: {
            maps: ReactNode[];
            labels: ReactNode[];
            pins: {
              loc?: string;
              name?: string;
              totalVotes?: number;
              party?: PartyVotes;
            }[];
          },
          feature,
          idx,
        ) => {
          const info = findInfo(feature.properties);
          const votes = findVotes(feature.properties);
          const totalVotes = votes?.reduce((acc, v) => acc + v.totalVotes, 0);
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
                key={`map-${name}-${idx}`}
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
            pins: [
              ...acc.pins,
              {
                loc: info?.loc,
                name,
                totalVotes,
                party,
              },
            ],
            labels: [
              ...acc.labels,
              withNames && ptLB && ptRT && info ? (
                <text
                  filter={"url(#colored-bg)"}
                  key={`label-${name}-${idx}`}
                  className="fill-white"
                  style={{ pointerEvents: "none" }}
                  textAnchor="middle"
                  fontSize={isXSmall ? "x-small" : "small"}
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
          pins: [],
        },
      ),
    [
      mapJSON.features,
      findInfo,
      findVotes,
      getName,
      topVotesParty,
      projection,
      path,
      onMouseMove,
      onMouseLeave,
      onTouchEnd,
      withNames,
      isXSmall,
      i18n.language,
      onMouseEnter,
      onClick,
    ],
  );
  const pins = useMemo(() => {
    const topBottomVotes = components.pins.reduce(
      (acc: { min: number; max: number }, curr) => ({
        min: Math.min(acc.min, curr.totalVotes || 0),
        max: Math.max(acc.max, curr.totalVotes || 0),
      }),
      {
        min: 0,
        max: 0,
      },
    );
    return components.pins.map(
      ({ loc: location, name, totalVotes, party }, idx) => {
        const loc = location?.split(",");
        const marker: ReactNode =
          party && loc?.length === 2 ? (
            <MapPin
              key={`pin-${name}-${idx}`}
              x={parseFloat(loc[0])}
              y={parseFloat(loc[1])}
              projection={projection}
              scale={(2 * (totalVotes || 0)) / topBottomVotes.max}
            />
          ) : null;
        return marker;
      },
    );
  }, [components.pins, projection]);

  return (
    <div>
      <svg className="overflow-hidden" width={size[0]} height={size[1]}>
        <defs>
          <filter id="colored-bg" x="-5%" width="110%" y="0%" height="100%">
            <feFlood floodColor="rgba(0,0,0,0.5)" />
            <feComposite operator="over" in="SourceGraphic"></feComposite>
          </filter>
        </defs>
        <g>{components.maps}</g>
        {pins}
        {components.labels}
      </svg>
      {children}
      {tooltip}
    </div>
  );
};
