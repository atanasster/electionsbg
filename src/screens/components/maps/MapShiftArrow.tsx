import { LocationInfo } from "@/data/dataTypes";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { RegionShift } from "./computeShifts";

const ARROW_W = 18;
const ARROW_H = 22;

export const MapShiftArrow = ({
  projection,
  info,
  shift,
}: {
  projection: d3.GeoProjection;
  info?: LocationInfo;
  shift?: RegionShift;
}) => {
  const isMedium = useMediaQueryMatch("md");
  const isLarge = useMediaQueryMatch("lg");
  const loc = info?.loc?.split(",");
  if (!loc || !shift || shift.deltaPp === undefined) return null;

  const x = parseFloat(loc[0]);
  const y = parseFloat(loc[1]);
  const p = projection([x, y]);
  if (!p) return null;

  // Hide arrows for shifts smaller than 0.25pp — they're noise on the map.
  const magnitude = Math.abs(shift.deltaPp);
  if (magnitude < 0.25) return null;

  const minScale = isLarge ? 0.7 : isMedium ? 0.6 : 0.5;
  const maxScale = isLarge ? 1.5 : isMedium ? 1.3 : 1.1;
  const clamped = Math.min(magnitude, 8);
  const scale = minScale + (clamped / 8) * (maxScale - minScale);
  const isUp = shift.deltaPp > 0;

  const fill = shift.currentColor ?? "#888";
  const stroke = shift.flipped ? (shift.priorColor ?? "#000") : "#fff";
  const strokeWidth = shift.flipped ? 2.5 : 1;

  const upPath = `M${ARROW_W / 2},0 L${ARROW_W},${ARROW_H} L0,${ARROW_H} Z`;
  const downPath = `M0,0 L${ARROW_W},0 L${ARROW_W / 2},${ARROW_H} Z`;

  return (
    <g
      className="pointer-events-none"
      transform={`translate(${p[0] - (ARROW_W * scale) / 2}, ${p[1] - (ARROW_H * scale) / 2}) scale(${scale})`}
    >
      <path
        d={isUp ? upPath : downPath}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    </g>
  );
};
