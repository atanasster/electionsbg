import type { GeoProjection } from "d3-geo";
import { LocationInfo } from "@/data/dataTypes";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { RegionShift } from "./computeShifts";
import { handDrawnLoopPath } from "@/ux/motion/handDrawn";
import { MOTION_MS } from "@/ux/motion/motionTokens";

const ARROW_W = 18;
const ARROW_H = 22;

export const MapShiftArrow = ({
  projection,
  info,
  shift,
}: {
  projection: GeoProjection;
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
      {/* Keyed on the delta so a NEW comparison (another election, another prior) replays
          the growth, while a re-render of the same one does not. Bigger shifts land first. */}
      <g
        key={shift.deltaPp}
        className="motion-grow"
        style={{
          animationDelay: `${Math.round((1 - clamped / 8) * MOTION_MS.base)}ms`,
        }}
      >
        <path
          d={isUp ? upPath : downPath}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
        {shift.flipped && (
          // The leader CHANGED here — the one shift on the map worth circling. Pen-drawn
          // around the arrow, seeded by the region so it is the same loop every render.
          <path
            className="motion-draw-on"
            style={{ animationDelay: `${MOTION_MS.slow}ms` }}
            d={handDrawnLoopPath(
              ARROW_W / 2,
              ARROW_H / 2 + 1,
              ARROW_W * 0.95,
              ARROW_H * 0.8,
              info?.ekatte || loc.join(","),
            )}
            pathLength={1}
            fill="none"
            stroke="hsl(var(--accent))"
            strokeWidth={1.75}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            aria-hidden
          />
        )}
      </g>
    </g>
  );
};
