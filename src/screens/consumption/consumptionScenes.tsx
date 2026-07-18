// Infographic scenes for the /consumption hub sub-page tiles. Same SceneFrame
// contract as the procurement/sector scenes (see src/ux/infographic/README.md):
// ink via currentColor, accent via var(--sector), PAPER for under-ink fills;
// decorative (aria-hidden via the frame). The lower-left is kept clear because
// the tile overlays its stat number there.

/* eslint-disable react-refresh/only-export-components -- CONSUMPTION_SCENES is a
   lookup table of scene components, not a fast-refresh boundary. */
import { FC } from "react";
import { SceneFrame, PAPER, Bars, TrendLine } from "@/ux/infographic";

// Обзор — bars + a rising trend, the analytics entry point.
const Overview: FC = () => (
  <SceneFrame>
    <rect
      x="28"
      y="20"
      width="90"
      height="14"
      rx="4"
      fill="var(--sector)"
      opacity=".85"
    />
    <rect
      x="28"
      y="42"
      width="70"
      height="6"
      rx="3"
      fill="currentColor"
      opacity=".3"
    />
    <TrendLine
      points={[
        [150, 78],
        [188, 58],
        [224, 66],
        [268, 34],
      ]}
      arrow
    />
    <Bars x={196} baseline={104} heights={[18, 32, 50]} barWidth={13} gap={9} />
  </SceneFrame>
);

// Продукти — a shopping basket with produce.
const Products: FC = () => (
  <SceneFrame>
    <path
      d="M120 46 h64 l-8 44 a6 6 0 0 1 -6 5 h-36 a6 6 0 0 1 -6 -5 Z"
      fill="var(--sector)"
      opacity=".85"
    />
    <path
      d="M132 36 l-10 10 M172 36 l10 10"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      fill="none"
    />
    <g stroke={PAPER} strokeWidth="2.4" opacity=".9">
      <path d="M138 58 v26 M152 58 v26 M166 58 v26" />
    </g>
  </SceneFrame>
);

// Карта на цените — a location pin over waves, carrying a € mark.
const PriceMap: FC = () => (
  <SceneFrame>
    <g fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".3">
      <path d="M0 92 q40 10 80 0 t80 0 t80 0 t60 0" />
      <path d="M0 104 q40 10 80 0 t80 0 t80 0 t60 0" opacity=".7" />
    </g>
    <path
      d="M150 24 c-14 0 -23 10 -23 23 c0 17 23 41 23 41 s23 -24 23 -41 c0 -13 -9 -23 -23 -23 Z"
      fill="var(--sector)"
      opacity=".9"
    />
    <text
      x="150"
      y="52"
      textAnchor="middle"
      fill={PAPER}
      fontSize="13"
      fontWeight="700"
      fontFamily="Georgia, serif"
    >
      €
    </text>
  </SceneFrame>
);

// Еврото — a euro coin, the changeover motif.
const EuroCoin: FC = () => (
  <SceneFrame>
    <circle cx="154" cy="58" r="34" fill="var(--sector)" opacity=".9" />
    <circle
      cx="154"
      cy="58"
      r="34"
      fill="none"
      stroke={PAPER}
      strokeWidth="2"
      opacity=".5"
    />
    <text
      x="154"
      y="72"
      textAnchor="middle"
      fill={PAPER}
      fontSize="40"
      fontWeight="700"
      fontFamily="Georgia, serif"
    >
      €
    </text>
  </SceneFrame>
);

// Инфлация — a rising price line over a baseline.
const Inflation: FC = () => (
  <SceneFrame>
    <path
      d="M108 92 h164"
      stroke="currentColor"
      strokeWidth="1.6"
      opacity=".3"
    />
    <TrendLine
      points={[
        [110, 84],
        [150, 70],
        [190, 74],
        [230, 44],
        [268, 30],
      ]}
      arrow
    />
  </SceneFrame>
);

// Достъпност — a balance scale (basket vs income).
const Affordability: FC = () => (
  <SceneFrame>
    <path
      d="M150 26 v60 M126 90 h48"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    <path
      d="M150 34 L112 48 M150 34 L188 48"
      stroke="currentColor"
      strokeWidth="2"
    />
    <circle cx="150" cy="28" r="4" fill="var(--sector)" />
    <g
      fill="var(--sector)"
      fillOpacity=".18"
      stroke="var(--sector)"
      strokeWidth="2"
    >
      <path d="M112 48 l-12 26 h48 Z" />
      <path d="M188 48 l-12 26 h48 Z" />
    </g>
  </SceneFrame>
);

export const CONSUMPTION_SCENES: Record<string, FC> = {
  overview: Overview,
  products: Products,
  map: PriceMap,
  euro: EuroCoin,
  inflation: Inflation,
  affordability: Affordability,
};
