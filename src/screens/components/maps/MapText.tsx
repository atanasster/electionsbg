import { LocationInfo } from "@/data/dataTypes";
import { GeoFeature } from "@/screens/components/maps/mapTypes";
import { geoDataCenter } from "@/screens/utils/d3_utils";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { GeoProjection } from "d3";
import { FC } from "react";
import { useTranslation } from "react-i18next";

export const MapText: FC<{
  info?: LocationInfo;
  feature: GeoFeature;
  projection: GeoProjection;
}> = ({ info, feature, projection }) => {
  const { i18n } = useTranslation();
  const isXSmall = useMediaQueryMatch("xs");
  const { ptLB, ptRT } = geoDataCenter(
    projection,
    feature as unknown as d3.GeoPermissibleObjects,
  );

  return (
    ptLB &&
    ptRT &&
    info && (
      <g className="pointer-events-none">
        <text
          filter={"url(#colored-bg)"}
          className="fill-white"
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
      </g>
    )
  );
};
