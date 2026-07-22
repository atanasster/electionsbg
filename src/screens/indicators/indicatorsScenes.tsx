// Infographic scenes for the /indicators hub tiles. Same SceneFrame contract as
// the procurement / sector scenes (see src/ux/infographic/README.md): structural
// ink via currentColor, accent pop via var(--sector), PAPER for under-ink fills;
// decorative (aria-hidden via the frame). These tiles carry no overlaid stat
// number, so — unlike the procurement scenes — the composition can use the whole
// canvas rather than keeping the lower-left clear.

/* eslint-disable react-refresh/only-export-components -- INDICATOR_SCENES is a
   lookup table of scene components, not a fast-refresh boundary. */
import { FC } from "react";
import { SceneFrame, PAPER, Bars, TrendLine, Donut } from "@/ux/infographic";

// Сравнение на всички кабинети — stacked tenure bands off a left axis, echoing
// the cabinet ribbon this tile replaces on the landing page.
const Cabinets: FC = () => (
  <SceneFrame>
    <rect
      x="34"
      y="20"
      width="3"
      height="78"
      rx="1.5"
      fill="currentColor"
      opacity=".5"
    />
    <rect
      x="42"
      y="26"
      width="150"
      height="12"
      rx="6"
      fill="var(--sector)"
      opacity=".85"
    />
    <rect
      x="42"
      y="44"
      width="216"
      height="12"
      rx="6"
      fill="currentColor"
      opacity=".28"
    />
    <rect
      x="42"
      y="62"
      width="118"
      height="12"
      rx="6"
      fill="var(--sector)"
      opacity=".6"
    />
    <rect
      x="42"
      y="80"
      width="182"
      height="12"
      rx="6"
      fill="currentColor"
      opacity=".28"
    />
  </SceneFrame>
);

// Икономика — a rising trend arrow over a growing bar group (growth / inflation /
// labour market).
const Economy: FC = () => (
  <SceneFrame>
    <TrendLine
      points={[
        [36, 82],
        [92, 58],
        [148, 66],
        [204, 38],
      ]}
      arrow
    />
    <Bars
      x={196}
      baseline={100}
      heights={[24, 40, 58]}
      barWidth={16}
      gap={10}
    />
  </SceneFrame>
);

// Фискални — three rising coin stacks (debt / balance / reserve), € on the tallest.
const CoinStack: FC<{ cx: number; count: number }> = ({ cx, count }) => (
  <g stroke="currentColor" strokeWidth="1.3" fill="var(--sector)" opacity=".9">
    {Array.from({ length: count }, (_, i) => (
      <ellipse key={i} cx={cx} cy={92 - i * 10} rx={19} ry={6} />
    ))}
  </g>
);
const Fiscal: FC = () => (
  <SceneFrame>
    <CoinStack cx={96} count={2} />
    <CoinStack cx={150} count={4} />
    <CoinStack cx={204} count={6} />
    <text
      x="204"
      y="37"
      textAnchor="middle"
      fill={PAPER}
      fontSize="12"
      fontWeight="700"
      fontFamily="Georgia, serif"
    >
      €
    </text>
  </SceneFrame>
);

// Бюджети — a stacked composition column beside a share donut (spending by
// cabinet / ministry).
const Budgets: FC = () => (
  <SceneFrame>
    <g>
      <rect
        x="74"
        y="28"
        width="48"
        height="18"
        rx="3"
        fill="var(--sector)"
        opacity=".9"
      />
      <rect
        x="74"
        y="48"
        width="48"
        height="14"
        fill="currentColor"
        opacity=".34"
      />
      <rect
        x="74"
        y="64"
        width="48"
        height="20"
        fill="var(--sector)"
        opacity=".55"
      />
      <rect
        x="74"
        y="86"
        width="48"
        height="10"
        rx="3"
        fill="currentColor"
        opacity=".22"
      />
    </g>
    <Donut cx={202} cy={58} r={26} pct={0.62} thickness={12} />
  </SceneFrame>
);

// Управление — a classical institution front (pediment on columns): corruption,
// WGI, trust in institutions.
const Governance: FC = () => (
  <SceneFrame>
    <path d="M150 24 L204 46 L96 46 Z" fill="var(--sector)" opacity=".16" />
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <path d="M96 46 L150 24 L204 46 Z" />
      <path d="M100 54 h100" />
      <path d="M106 54 v38 M124 54 v38 M142 54 v38 M158 54 v38 M176 54 v38 M194 54 v38" />
      <path d="M94 92 h112" />
    </g>
  </SceneFrame>
);

// Общество — a row of people (unemployment / inequality / poverty); the middle
// figure is picked out in the accent.
const Person: FC<{ cx: number; cy: number; r: number; accent?: boolean }> = ({
  cx,
  cy,
  r,
  accent,
}) => (
  <g
    fill={accent ? "var(--sector)" : "currentColor"}
    opacity={accent ? 0.9 : 0.68}
  >
    <circle cx={cx} cy={cy} r={r} />
    <path
      d={`M${cx - r * 1.7} 96 a${r * 1.7} ${r * 1.7} 0 0 1 ${r * 3.4} 0 Z`}
    />
  </g>
);
const Society: FC = () => (
  <SceneFrame>
    <Person cx={102} cy={64} r={10} />
    <Person cx={150} cy={52} r={13} accent />
    <Person cx={198} cy={64} r={10} />
  </SceneFrame>
);

// Сравнение с ЕС — two comparison bars (BG vs EU) under an arc of EU stars.
const Star: FC<{ cx: number; cy: number }> = ({ cx, cy }) => (
  <path
    transform={`translate(${cx} ${cy})`}
    d="M0 -7 L1.6 -2.2 L6.7 -2.2 L2.6 0.8 L4.1 5.7 L0 2.7 L-4.1 5.7 L-2.6 0.8 L-6.7 -2.2 L-1.6 -2.2 Z"
    fill="var(--sector)"
  />
);
const Compare: FC = () => (
  <SceneFrame>
    <rect
      x="150"
      y="46"
      width="34"
      height="50"
      rx="3"
      fill="var(--sector)"
      opacity=".9"
    />
    <rect
      x="196"
      y="30"
      width="34"
      height="66"
      rx="3"
      fill="currentColor"
      opacity=".3"
    />
    <path
      d="M148 99 h84"
      stroke="currentColor"
      strokeWidth="1.6"
      opacity=".4"
    />
    <g>
      <Star cx={54} cy={48} />
      <Star cx={76} cy={34} />
      <Star cx={102} cy={28} />
      <Star cx={128} cy={34} />
      <Star cx={150} cy={48} />
    </g>
  </SceneFrame>
);

// Keyed to the scene union (not `string`) so a HUB_TILES entry naming a scene
// that isn't drawn here fails at build time rather than rendering `<undefined />`.
export type IndicatorSceneKey =
  | "cabinets"
  | "economy"
  | "fiscal"
  | "budgets"
  | "governance"
  | "society"
  | "compare";

export const INDICATOR_SCENES: Record<IndicatorSceneKey, FC> = {
  cabinets: Cabinets,
  economy: Economy,
  fiscal: Fiscal,
  budgets: Budgets,
  governance: Governance,
  society: Society,
  compare: Compare,
};
