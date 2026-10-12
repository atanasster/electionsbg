// Infographic vignettes for the /sector/roads hub tiles — the same drawing
// contract as cultureScenes.tsx (300×116 SceneFrame, ink = currentColor, accent
// = var(--sector), PAPER for under-ink fills).
//
// One scene per tile, each showing the STRUCTURE its destination is about.
//
// DENSE MARKS STAY OUT OF THE BOTTOM-LEFT: the tile's metric is overlaid there.
// `roadsScenes.test.tsx` fails any `var(--sector)`-filled mark overlapping
// x < 132 AND y > 72.

/* eslint-disable react-refresh/only-export-components -- ROADS_SCENES is a lookup
   table of scene components, not a fast-refresh boundary. */
import { type FC } from "react";
import { SceneFrame, PAPER } from "@/ux/infographic";

const ACCENT = "var(--sector)";

// Разходи във времето — stacked yearly columns, one far taller (the 2024 peak).
const SpendScene: FC = () => (
  <SceneFrame>
    {[
      [146, 70],
      [164, 60],
      [182, 74],
      [200, 52],
      [218, 22],
      [236, 64],
      [254, 68],
    ].map(([x, y]) => (
      <rect
        key={x}
        x={x}
        y={y}
        width={12}
        height={98 - y}
        fill={ACCENT}
        opacity={y < 30 ? 0.95 : 0.55}
      />
    ))}
    <path
      d="M140 98 H272"
      stroke="currentColor"
      strokeWidth={1}
      opacity={0.4}
    />
  </SceneFrame>
);

// Пътната мрежа — a motorway trunk with branches, thicker where more is spent.
const NetworkScene: FC = () => (
  <SceneFrame>
    <g fill="none" stroke={ACCENT} strokeLinecap="round">
      <path
        d="M146 70 C 180 64, 210 50, 270 44"
        strokeWidth={6}
        opacity={0.85}
      />
      <path
        d="M196 56 C 200 40, 214 26, 232 18"
        strokeWidth={3}
        opacity={0.6}
      />
      <path
        d="M222 50 C 230 66, 246 80, 262 92"
        strokeWidth={2}
        opacity={0.5}
      />
    </g>
    <circle cx={146} cy={70} r={4} fill={ACCENT} />
    <circle cx={270} cy={44} r={4} fill={ACCENT} />
  </SceneFrame>
);

// Цена на километър — a ruler with a marked segment.
const CostsScene: FC = () => (
  <SceneFrame>
    <rect
      x={142}
      y={50}
      width={128}
      height={18}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1}
      opacity={0.8}
    />
    {Array.from({ length: 9 }, (_, i) => 146 + i * 15).map((x, i) => (
      <path
        key={x}
        d={`M${x} 50 V${i % 2 ? 56 : 60}`}
        stroke="currentColor"
        strokeWidth={1}
        opacity={0.6}
      />
    ))}
    <rect
      x={176}
      y={32}
      width={45}
      height={12}
      rx={2}
      fill={ACCENT}
      opacity={0.85}
    />
    <path d="M176 44 V50 M221 44 V50" stroke={ACCENT} strokeWidth={1.5} />
  </SceneFrame>
);

// Еврофондове — a ring of stars around a project block.
const FundsScene: FC = () => (
  <SceneFrame>
    {Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      return (
        <circle
          key={i}
          cx={210 + 36 * Math.cos(a)}
          cy={56 + 36 * Math.sin(a)}
          r={3.2}
          fill={ACCENT}
          opacity={0.8}
        />
      );
    })}
    <rect
      x={196}
      y={44}
      width={28}
      height={24}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1.2}
    />
  </SceneFrame>
);

// Конкуренция — bids per contract: most lanes with several marks, a few with one.
const CompetitionScene: FC = () => (
  <SceneFrame>
    {[22, 40, 58, 76].map((y, row) => (
      <g key={y}>
        <path
          d={`M150 ${y} H270`}
          stroke="currentColor"
          strokeWidth={0.8}
          opacity={0.3}
        />
        {Array.from({ length: row === 1 ? 1 : 4 - (row % 2) }, (_, i) => (
          <circle
            key={i}
            cx={160 + i * 22}
            cy={y}
            r={5}
            fill={ACCENT}
            opacity={row === 1 ? 0.95 : 0.5}
          />
        ))}
      </g>
    ))}
  </SceneFrame>
);

// Рисков профил — a grade ladder, the two highest grades lit.
const RiskScene: FC = () => (
  <SceneFrame>
    {["A", "B", "C", "D", "E"].map((_, i) => (
      <rect
        key={i}
        x={150 + i * 24}
        y={78 - i * 12}
        width={18}
        height={20 + i * 12}
        fill={i >= 3 ? ACCENT : PAPER}
        stroke="currentColor"
        strokeWidth={i >= 3 ? 0 : 1}
        opacity={i >= 3 ? 0.9 : 0.7}
      />
    ))}
  </SceneFrame>
);

// Процедури — a stack of notices, one struck through and reissued.
const TendersScene: FC = () => (
  <SceneFrame>
    {[0, 1, 2].map((i) => (
      <rect
        key={i}
        x={160 + i * 10}
        y={20 + i * 10}
        width={70}
        height={52}
        fill={PAPER}
        stroke="currentColor"
        strokeWidth={1}
        opacity={0.85}
      />
    ))}
    <path
      d="M186 50 H246 M186 60 H236 M186 70 H242"
      stroke={ACCENT}
      strokeWidth={2}
      opacity={0.8}
    />
  </SceneFrame>
);

// Упражнени опции — a contract bar and its pre-set +50% extension, dashed.
const OptionsScene: FC = () => (
  <SceneFrame>
    <rect x={146} y={40} width={80} height={22} fill={ACCENT} opacity={0.85} />
    <rect
      x={226}
      y={40}
      width={40}
      height={22}
      fill="none"
      stroke={ACCENT}
      strokeWidth={2}
      strokeDasharray="4 3"
    />
    <path d="M226 30 V72" stroke="currentColor" strokeWidth={1} opacity={0.5} />
  </SceneFrame>
);

// АПИ и ОПУ — one agency fanning out to its regional directorates.
const AwarderScene: FC = () => (
  <SceneFrame>
    <rect x={196} y={14} width={30} height={20} fill={ACCENT} opacity={0.9} />
    {[150, 176, 202, 228, 254].map((x) => (
      <g key={x}>
        <path
          d={`M211 34 L${x + 6} 66`}
          stroke="currentColor"
          strokeWidth={1}
          opacity={0.4}
        />
        <rect
          x={x}
          y={66}
          width={12}
          height={12}
          fill={ACCENT}
          opacity={0.55}
        />
      </g>
    ))}
  </SceneFrame>
);

// Изпълнители — a ranked column, the first rows long.
const ContractorsScene: FC = () => (
  <SceneFrame>
    {[110, 72, 58, 46, 36, 28].map((w, i) => (
      <rect
        key={i}
        x={150}
        y={16 + i * 13}
        width={w}
        height={8}
        rx={2}
        fill={ACCENT}
        opacity={i === 0 ? 0.95 : 0.55}
      />
    ))}
  </SceneFrame>
);

// „Автомагистрали" ЕАД — a state building with the road coming out of it.
const InhouseScene: FC = () => (
  <SceneFrame>
    <path d="M168 34 L196 18 L224 34 Z" fill={ACCENT} opacity={0.9} />
    <rect
      x={172}
      y={34}
      width={48}
      height={30}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1.2}
    />
    <path
      d="M220 56 C 240 56, 252 62, 272 80"
      stroke={ACCENT}
      strokeWidth={6}
      fill="none"
      strokeLinecap="round"
      opacity={0.7}
    />
  </SceneFrame>
);

// ОПУ — a grid of oblast cells, a few marked red-hot.
const RegionsScene: FC = () => (
  <SceneFrame>
    {Array.from({ length: 12 }, (_, i) => (
      <rect
        key={i}
        x={150 + (i % 4) * 28}
        y={18 + Math.floor(i / 4) * 24}
        width={24}
        height={20}
        rx={2}
        fill={i === 2 || i === 9 ? ACCENT : PAPER}
        stroke="currentColor"
        strokeWidth={i === 2 || i === 9 ? 0 : 0.8}
        opacity={i === 2 || i === 9 ? 0.9 : 0.6}
      />
    ))}
  </SceneFrame>
);

export const ROADS_SCENES: Record<string, FC> = {
  spend: SpendScene,
  network: NetworkScene,
  costs: CostsScene,
  funds: FundsScene,
  competition: CompetitionScene,
  risk: RiskScene,
  tenders: TendersScene,
  options: OptionsScene,
  awarder: AwarderScene,
  contractors: ContractorsScene,
  inhouse: InhouseScene,
  regions: RegionsScene,
};
