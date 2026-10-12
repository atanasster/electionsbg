// Infographic vignettes for the /water hub tiles — the same drawing contract as
// roadsScenes.tsx (300×116 SceneFrame, ink = currentColor, accent =
// var(--sector), PAPER for under-ink fills).
//
// One scene per tile, each showing the STRUCTURE its destination is about.
//
// DENSE MARKS STAY OUT OF THE BOTTOM-LEFT: the tile's metric is overlaid there.
// `waterScenes.test.tsx` fails any `var(--sector)`-filled mark overlapping
// x < 132 AND y > 72.

/* eslint-disable react-refresh/only-export-components -- WATER_SCENES is a lookup
   table of scene components, not a fast-refresh boundary. */
import { type FC } from "react";
import { SceneFrame, PAPER } from "@/ux/infographic";

const ACCENT = "var(--sector)";

// Оператори — a grid of utility badges, a few struck out (no longer operating).
const OperatorsScene: FC = () => (
  <SceneFrame>
    {Array.from({ length: 12 }, (_, i) => {
      const x = 150 + (i % 4) * 30;
      const y = 16 + Math.floor(i / 4) * 28;
      const dead = i === 5 || i === 10;
      return (
        <g key={i}>
          <circle
            cx={x}
            cy={y + 10}
            r={10}
            fill={dead ? PAPER : ACCENT}
            stroke="currentColor"
            strokeWidth={dead ? 0.8 : 0}
            opacity={dead ? 0.6 : 0.75}
          />
          {dead ? (
            <path
              d={`M${x - 8} ${y + 18} L${x + 8} ${y + 2}`}
              stroke="currentColor"
              strokeWidth={1}
              opacity={0.6}
            />
          ) : null}
        </g>
      );
    })}
  </SceneFrame>
);

// Карта — pins scattered over a country outline.
const MapScene: FC = () => (
  <SceneFrame>
    <path
      d="M146 34 C 170 20, 220 16, 266 26 C 280 44, 276 70, 262 86 C 230 96, 180 98, 152 84 C 140 66, 138 48, 146 34 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      opacity={0.45}
    />
    {[
      [168, 40],
      [198, 34],
      [236, 38],
      [256, 58],
      [214, 62],
      [180, 70],
      [234, 80],
    ].map(([x, y]) => (
      <circle
        key={`${x}-${y}`}
        cx={x}
        cy={y}
        r={4}
        fill={ACCENT}
        opacity={0.85}
      />
    ))}
  </SceneFrame>
);

// Холдингът — a parent node fanning out to its subsidiaries.
const HoldingScene: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth={0.8} opacity={0.5}>
      {[150, 178, 206, 234, 262].map((x) => (
        <path key={x} d={`M206 34 L${x} 82`} />
      ))}
    </g>
    <rect
      x={190}
      y={16}
      width={32}
      height={20}
      rx={3}
      fill={ACCENT}
      opacity={0.9}
    />
    {[150, 178, 206, 234, 262].map((x) => (
      <rect
        key={x}
        x={x - 9}
        y={82}
        width={18}
        height={14}
        rx={2}
        fill={PAPER}
        stroke="currentColor"
        strokeWidth={0.8}
        opacity={0.7}
      />
    ))}
  </SceneFrame>
);

// Софийска вода — one large city block with a contract seal (the concession).
const SofiaScene: FC = () => (
  <SceneFrame>
    {[
      [150, 52, 20, 46],
      [174, 30, 24, 68],
      [202, 44, 18, 54],
      [224, 22, 22, 76],
      [250, 56, 18, 42],
    ].map(([x, y, w, h]) => (
      <rect
        key={x}
        x={x}
        y={y}
        width={w}
        height={h}
        fill={PAPER}
        stroke="currentColor"
        strokeWidth={0.8}
        opacity={0.7}
      />
    ))}
    <circle cx={258} cy={28} r={12} fill={ACCENT} opacity={0.9} />
  </SceneFrame>
);

// По функция — a pipe split into segments of different widths.
const FunctionsScene: FC = () => (
  <SceneFrame>
    {[
      [146, 44, 0.9],
      [190, 16, 0.6],
      [206, 30, 0.75],
      [236, 36, 0.5],
    ].map(([x, w, o]) => (
      <rect
        key={x}
        x={x}
        y={42}
        width={w}
        height={24}
        rx={2}
        fill={ACCENT}
        opacity={o}
      />
    ))}
    <path
      d="M140 54 H146 M272 54 H280"
      stroke="currentColor"
      strokeWidth={2}
      opacity={0.5}
    />
  </SceneFrame>
);

// Конкуренция — envelopes per tender, many with a single one.
const CompetitionScene: FC = () => (
  <SceneFrame>
    {[1, 3, 1, 1, 2, 1, 4, 1].map((n, i) =>
      Array.from({ length: n }, (_, k) => (
        <rect
          key={`${i}-${k}`}
          x={148 + i * 15}
          y={86 - k * 14}
          width={11}
          height={10}
          rx={1}
          fill={n === 1 ? ACCENT : PAPER}
          stroke="currentColor"
          strokeWidth={n === 1 ? 0 : 0.8}
          opacity={n === 1 ? 0.85 : 0.6}
        />
      )),
    )}
  </SceneFrame>
);

// Изпълнители — ranked bars, one loop arrow back into the sector (intra-group).
const ContractorsScene: FC = () => (
  <SceneFrame>
    {[118, 92, 70, 52, 40].map((w, i) => (
      <rect
        key={i}
        x={150}
        y={16 + i * 16}
        width={w}
        height={10}
        rx={2}
        fill={ACCENT}
        opacity={0.85 - i * 0.12}
      />
    ))}
    <path
      d="M276 30 C 290 50, 290 70, 272 86"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeDasharray="3 3"
      opacity={0.5}
    />
  </SceneFrame>
);

// Всички договори — a ledger of rows.
const ContractsScene: FC = () => (
  <SceneFrame>
    {Array.from({ length: 6 }, (_, i) => (
      <g key={i}>
        <rect
          x={146}
          y={14 + i * 14}
          width={96}
          height={8}
          rx={1}
          fill={PAPER}
          stroke="currentColor"
          strokeWidth={0.6}
          opacity={0.6}
        />
        <rect
          x={248}
          y={14 + i * 14}
          width={24}
          height={8}
          rx={1}
          fill={ACCENT}
          opacity={0.4 + i * 0.08}
        />
      </g>
    ))}
  </SceneFrame>
);

// Воден режим — a tap with a clock: water on a schedule.
const RationingScene: FC = () => (
  <SceneFrame>
    <path
      d="M160 34 H204 V46 H176 V58"
      fill="none"
      stroke="currentColor"
      strokeWidth={4}
      opacity={0.6}
    />
    {[68, 80, 92].map((y) => (
      <circle key={y} cx={176} cy={y} r={3} fill={ACCENT} opacity={0.8} />
    ))}
    <circle
      cx={240}
      cy={52}
      r={26}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1}
      opacity={0.7}
    />
    <path
      d="M240 52 L240 34 A18 18 0 0 1 256 44 Z"
      fill={ACCENT}
      opacity={0.85}
    />
  </SceneFrame>
);

// Водоснабдяване и пречистване — a pipe into a treatment basin.
const AccessScene: FC = () => (
  <SceneFrame>
    <path
      d="M146 40 H206"
      stroke={ACCENT}
      strokeWidth={8}
      strokeLinecap="round"
      opacity={0.75}
    />
    <rect
      x={212}
      y={30}
      width={60}
      height={50}
      rx={6}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1}
      opacity={0.7}
    />
    <path
      d="M218 58 Q 232 50 242 58 T 266 58"
      fill="none"
      stroke={ACCENT}
      strokeWidth={2}
      opacity={0.85}
    />
  </SceneFrame>
);

// Речни корита — a winding river with a cleared stretch.
const RiverbedScene: FC = () => (
  <SceneFrame>
    <path
      d="M140 24 C 170 40, 160 60, 196 64 C 230 68, 222 94, 276 98"
      fill="none"
      stroke="currentColor"
      strokeWidth={10}
      opacity={0.18}
    />
    <path
      d="M196 64 C 230 68, 222 94, 276 98"
      fill="none"
      stroke={ACCENT}
      strokeWidth={4}
      opacity={0.85}
    />
  </SceneFrame>
);

// Еврофондове — contracted vs paid, two stacked columns.
const FundsScene: FC = () => (
  <SceneFrame>
    {[
      [170, 18],
      [216, 58],
    ].map(([x, y], i) => (
      <rect
        key={x}
        x={x}
        y={y}
        width={34}
        height={98 - y}
        fill={ACCENT}
        opacity={i ? 0.9 : 0.4}
      />
    ))}
    <path
      d="M160 98 H262"
      stroke="currentColor"
      strokeWidth={1}
      opacity={0.4}
    />
  </SceneFrame>
);

export const WATER_SCENES: Record<string, FC> = {
  operators: OperatorsScene,
  map: MapScene,
  holding: HoldingScene,
  sofia: SofiaScene,
  functions: FunctionsScene,
  competition: CompetitionScene,
  contractors: ContractorsScene,
  contracts: ContractsScene,
  rationing: RationingScene,
  access: AccessScene,
  riverbed: RiverbedScene,
  funds: FundsScene,
};
