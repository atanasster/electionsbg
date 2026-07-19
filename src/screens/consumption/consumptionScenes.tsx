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

// Моята кошница — a checked shopping list, the personal basket.
const MyBasket: FC = () => (
  <SceneFrame>
    <rect
      x="116"
      y="20"
      width="72"
      height="76"
      rx="4"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <g stroke="var(--sector)" strokeWidth="3" strokeLinecap="round">
      <path d="M128 38 h44 M128 52 h44 M128 66 h30" />
    </g>
    <circle cx="182" cy="82" r="14" fill="var(--sector)" />
    <path
      d="M176 82 l4 4 l8 -9"
      fill="none"
      stroke={PAPER}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </SceneFrame>
);

// Вериги — a storefront with a price tag, the retail chains.
const Chains: FC = () => (
  <SceneFrame>
    <rect
      x="112"
      y="40"
      width="84"
      height="52"
      rx="3"
      fill="var(--sector)"
      opacity=".85"
    />
    <path d="M104 40 h100 l-8 -16 h-84 Z" fill="currentColor" opacity=".3" />
    <rect
      x="128"
      y="60"
      width="20"
      height="32"
      rx="2"
      fill={PAPER}
      opacity=".9"
    />
    <rect
      x="160"
      y="60"
      width="24"
      height="18"
      rx="2"
      fill={PAPER}
      opacity=".55"
    />
    <circle cx="196" cy="30" r="9" fill="var(--sector)" />
    <text
      x="196"
      y="34"
      textAnchor="middle"
      fill={PAPER}
      fontSize="10"
      fontWeight="700"
      fontFamily="Georgia, serif"
    >
      €
    </text>
  </SceneFrame>
);

// Категории — a grid of category tags.
const Categories: FC = () => (
  <SceneFrame>
    <g fill="var(--sector)">
      <rect x="112" y="30" width="34" height="26" rx="4" opacity=".85" />
      <rect x="156" y="30" width="34" height="26" rx="4" opacity=".55" />
      <rect x="112" y="64" width="34" height="26" rx="4" opacity=".55" />
      <rect x="156" y="64" width="34" height="26" rx="4" opacity=".85" />
    </g>
  </SceneFrame>
);

// Промоции — a price tag with a percent cut.
const Deals: FC = () => (
  <SceneFrame>
    <path
      d="M118 30 h52 l30 30 -46 46 -36 -36 v-40 a10 10 0 0 1 10 -10 Z"
      fill="var(--sector)"
      opacity=".85"
    />
    <circle cx="134" cy="46" r="7" fill={PAPER} />
    <g stroke={PAPER} strokeWidth="3.4" strokeLinecap="round">
      <path d="M150 78 l24 -24" />
    </g>
    <circle
      cx="153"
      cy="57"
      r="4.5"
      fill="none"
      stroke={PAPER}
      strokeWidth="2.6"
    />
    <circle
      cx="171"
      cy="75"
      r="4.5"
      fill="none"
      stroke={PAPER}
      strokeWidth="2.6"
    />
  </SceneFrame>
);

// Горива — a fuel pump.
const FuelScene: FC = () => (
  <SceneFrame>
    <rect
      x="116"
      y="30"
      width="46"
      height="66"
      rx="5"
      fill="var(--sector)"
      opacity=".85"
    />
    <rect
      x="124"
      y="40"
      width="30"
      height="18"
      rx="2"
      fill={PAPER}
      opacity=".9"
    />
    <path
      d="M162 44 h12 a6 6 0 0 1 6 6 v28 a8 8 0 0 1 -8 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
    />
    <rect
      x="170"
      y="38"
      width="10"
      height="9"
      rx="2"
      fill="currentColor"
      opacity=".5"
    />
  </SceneFrame>
);

// Ток — a lightning bolt.
const ElectricityScene: FC = () => (
  <SceneFrame>
    <path
      d="M164 24 L142 62 L156 62 L140 96 L182 54 L164 54 Z"
      fill="var(--sector)"
      opacity=".85"
    />
    <path
      d="M196 34 a30 30 0 0 1 0 52"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      opacity=".45"
    />
  </SceneFrame>
);

// Природен газ — a gas flame.
const GasScene: FC = () => (
  <SceneFrame>
    <path
      d="M158 22 c 14 16 22 26 22 40 a22 22 0 0 1 -44 0 c 0 -10 6 -16 10 -22 c 3 6 7 8 10 6 c 4 -3 1 -14 -8 -24 z"
      fill="var(--sector)"
      opacity=".85"
    />
    <path
      d="M158 58 c 6 6 9 11 9 17 a9 9 0 0 1 -18 0 c 0 -6 5 -10 9 -17 z"
      fill={PAPER}
      opacity=".85"
    />
  </SceneFrame>
);

// Спрямо ЕС — diverging bars around an EU=100 baseline.
const EuCompare: FC = () => (
  <SceneFrame>
    <path
      d="M150 20 v78"
      stroke="currentColor"
      strokeWidth="1.4"
      opacity=".35"
    />
    <g fill="var(--sector)" opacity=".85">
      <rect x="150" y="30" width="34" height="10" rx="2" />
      <rect x="118" y="46" width="32" height="10" rx="2" opacity=".6" />
      <rect x="150" y="62" width="20" height="10" rx="2" />
      <rect x="104" y="78" width="46" height="10" rx="2" opacity=".6" />
    </g>
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

// Кошница на цените — a receipt with a € total, the basket dashboard.
const PriceReceipt: FC = () => (
  <SceneFrame>
    <rect
      x="118"
      y="18"
      width="72"
      height="84"
      rx="4"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <g stroke="var(--sector)" strokeWidth="3" strokeLinecap="round">
      <path d="M130 36 h48 M130 50 h48 M130 64 h32" />
    </g>
    <path
      d="M130 82 h48"
      stroke="currentColor"
      strokeWidth="1.4"
      opacity=".4"
    />
    <text
      x="178"
      y="97"
      textAnchor="end"
      fill="var(--sector)"
      fontSize="15"
      fontWeight="700"
      fontFamily="Georgia, serif"
    >
      €
    </text>
  </SceneFrame>
);

// € на килограм — a weight with a kg label, the unit-price explorer.
const UnitPrice: FC = () => (
  <SceneFrame>
    <path
      d="M138 42 q12 -16 24 0"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <circle cx="150" cy="64" r="30" fill="var(--sector)" opacity=".9" />
    <text
      x="150"
      y="70"
      textAnchor="middle"
      fill={PAPER}
      fontSize="16"
      fontWeight="700"
      fontFamily="Georgia, serif"
    >
      kg
    </text>
    <circle cx="192" cy="34" r="11" fill="var(--sector)" />
    <text
      x="192"
      y="38"
      textAnchor="middle"
      fill={PAPER}
      fontSize="11"
      fontWeight="700"
      fontFamily="Georgia, serif"
    >
      €
    </text>
  </SceneFrame>
);

export const CONSUMPTION_SCENES: Record<string, FC> = {
  overview: Overview,
  prices: PriceReceipt,
  unit: UnitPrice,
  products: Products,
  map: PriceMap,
  euro: EuroCoin,
  inflation: Inflation,
  affordability: Affordability,
  chains: Chains,
  basket: MyBasket,
  categories: Categories,
  eu: EuCompare,
  deals: Deals,
  fuel: FuelScene,
  electricity: ElectricityScene,
  gas: GasScene,
};
