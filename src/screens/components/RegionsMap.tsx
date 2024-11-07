import * as d3 from "d3";
import { Regions } from "../data/json_types";
import { RegionMap } from "./RegionMap";
import { getDataProjection } from "../utils/d3_utils";
import { useState } from "react";

export const RegionsMap: React.FC<
  React.PropsWithChildren<{ regions: Regions; size: [number, number] }>
> = ({ regions, size }) => {
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    content: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    content: "",
  });
  const path = getDataProjection(regions as d3.GeoPermissibleObjects, size);
  const provincesList = regions.features.map((feature) => {
    const name = feature.properties.nuts3;
    return (
      <RegionMap
        key={feature.properties.nuts3}
        path={path}
        name={name}
        feature={feature}
        onMouseEnter={(e) => {
          setTooltip({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            content: name,
          });
        }}
        onMouseMove={(e) => {
          setTooltip((prev) => ({
            ...prev,
            x: e.clientX,
            y: e.clientY,
          }));
        }}
        onMouseLeave={() => {
          setTooltip({ visible: false, x: 0, y: 0, content: "" });
        }}
      />
    );
  });

  return (
    <div>
      <svg width={size[0]} height={size[1]}>
        <g>{provincesList}</g>
      </svg>
      {tooltip.visible && (
        <div
          className="tooltip absolute bg-white border border-black p-2"
          style={{ left: `${tooltip.x + 5}px`, top: `${tooltip.y + 50}px` }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  );
};
