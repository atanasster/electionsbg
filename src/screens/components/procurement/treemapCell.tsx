// Shared cell renderer for the procurement treemaps — both the landing-page
// "largest contractors / awarders" ranking tiles (ProcurementTreemapTile) and
// the per-entity portfolio chart (CompanyPortfolioTreemap). They share one
// terracotta→slate visual language; the colour ramp lives in ./treemapPalette,
// the borders + label logic live here.

import { FC } from "react";
import { treemapCellColor } from "./treemapPalette";

export const TreemapCell: FC<{
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  name?: string;
  // Precomputed per-datum colour from treemapCellColor — recharts threads it
  // through the node. Falls back to a default ramp if a caller omits it.
  color?: string;
}> = ({ x = 0, y = 0, width = 0, height = 0, index = 0, name = "", color }) => {
  const fill = color ?? treemapCellColor(index, 24);
  // Lower threshold than before so more (smaller) tiles still get a label; the
  // crisp background-gap border keeps neighbours separated even when unlabelled.
  const showLabel = width > 34 && height > 14;
  const maxChars = Math.max(1, Math.floor((width - 8) / 6.5));
  const label =
    name.length > maxChars
      ? `${name.slice(0, Math.max(1, maxChars - 1))}…`
      : name;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        stroke="var(--background)"
        strokeWidth={2}
      />
      {showLabel ? (
        <text
          x={x + 5}
          y={y + 14}
          fontSize={11}
          fill="#fff"
          // paint-order:stroke draws a thin dark halo behind the glyphs so the
          // white label stays legible on the light tan mid-tiles too.
          style={{
            pointerEvents: "none",
            paintOrder: "stroke",
            stroke: "rgba(0,0,0,0.38)",
            strokeWidth: 2.5,
            strokeLinejoin: "round",
          }}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
};
