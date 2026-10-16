// Infographic vignettes for the /sector/transport hub tiles — the same drawing
// contract as roadsScenes.tsx / waterScenes.tsx (300×116 SceneFrame, ink =
// currentColor, accent = var(--sector), PAPER for under-ink fills).
//
// One scene per tile, each showing the STRUCTURE its destination is about.
//
// DENSE MARKS STAY OUT OF THE BOTTOM-LEFT: the tile's metric is overlaid there.
// `transportScenes.test.tsx` fails any `var(--sector)`-filled mark overlapping
// x < 132 AND y > 72.

/* eslint-disable react-refresh/only-export-components -- TRANSPORT_SCENES is a
   lookup table of scene components, not a fast-refresh boundary. */
import { type FC } from "react";
import { SceneFrame, PAPER } from "@/ux/infographic";

const ACCENT = "var(--sector)";

// Карта на проектите — a country outline crossed by two line sections and pins.
const MapScene: FC = () => (
  <SceneFrame>
    <path
      d="M146 30 C 172 18, 226 14, 270 26 C 284 44, 280 72, 264 88 C 230 98, 178 98, 152 84 C 140 64, 138 46, 146 30 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      opacity={0.45}
    />
    <path
      d="M160 40 L204 58 L250 74"
      fill="none"
      stroke={ACCENT}
      strokeWidth={4}
      strokeLinecap="round"
      opacity={0.85}
    />
    <path
      d="M190 84 L236 40"
      fill="none"
      stroke={ACCENT}
      strokeWidth={2.5}
      strokeLinecap="round"
      opacity={0.6}
    />
    {[
      [160, 40],
      [250, 74],
      [262, 36],
    ].map(([x, y]) => (
      <circle key={`${x}-${y}`} cx={x} cy={y} r={4.5} fill={ACCENT} />
    ))}
  </SceneFrame>
);

// Железници — a track with sleepers and a train on it.
const RailScene: FC = () => (
  <SceneFrame>
    <path
      d="M140 66 H290 M140 76 H290"
      stroke="currentColor"
      strokeWidth={1.2}
      opacity={0.55}
    />
    {Array.from({ length: 11 }, (_, i) => (
      <path
        key={i}
        d={`M${144 + i * 14} 62 V80`}
        stroke="currentColor"
        strokeWidth={2}
        opacity={0.3}
      />
    ))}
    {[0, 1, 2].map((i) => (
      <rect
        key={i}
        x={168 + i * 36}
        y={36}
        width={32}
        height={24}
        rx={i === 2 ? 8 : 3}
        fill={ACCENT}
        opacity={0.9 - i * 0.15}
      />
    ))}
  </SceneFrame>
);

// Пристанища и Дунав — a quay with a crane and a ship on the water.
const MaritimeScene: FC = () => (
  <SceneFrame>
    <path
      d="M140 84 Q 160 78 180 84 T 220 84 T 260 84 T 296 84"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      opacity={0.5}
    />
    <path d="M176 66 H262 L250 80 H188 Z" fill={ACCENT} opacity={0.85} />
    <rect
      x={204}
      y={48}
      width={30}
      height={16}
      rx={2}
      fill={ACCENT}
      opacity={0.6}
    />
    <path
      d="M270 80 V22 H296 M270 30 L292 22"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      opacity={0.6}
    />
  </SceneFrame>
);

// Въздушен транспорт — a runway and a plane climbing off it.
const AviationScene: FC = () => (
  <SceneFrame>
    <path
      d="M150 72 L260 46"
      stroke="currentColor"
      strokeWidth={1}
      strokeDasharray="4 4"
      opacity={0.45}
    />
    <rect
      x={146}
      y={40}
      width={8}
      height={8}
      rx={4}
      fill={ACCENT}
      opacity={0.5}
    />
    <path
      d="M248 34 L282 26 L276 32 L292 40 L284 42 L270 38 L262 46 L256 44 L260 38 L246 40 Z"
      fill={ACCENT}
      opacity={0.9}
    />
    <rect
      x={180}
      y={20}
      width={14}
      height={14}
      rx={2}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={0.8}
      opacity={0.6}
    />
    <path
      d="M187 34 V52"
      stroke="currentColor"
      strokeWidth={1.5}
      opacity={0.5}
    />
  </SceneFrame>
);

// Конкуренция — envelopes per tender, a minority with a single one.
const CompetitionScene: FC = () => (
  <SceneFrame>
    {[3, 1, 2, 4, 1, 3, 2, 1].map((n, i) =>
      Array.from({ length: n }, (_, k) => (
        <rect
          key={`${i}-${k}`}
          x={148 + i * 16}
          y={62 - k * 13}
          width={12}
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

// Без обявление — a notice board with its notice missing, a handshake beside it.
const DirectScene: FC = () => (
  <SceneFrame>
    <rect
      x={150}
      y={18}
      width={56}
      height={44}
      rx={3}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1}
      strokeDasharray="3 3"
      opacity={0.6}
    />
    <path
      d="M178 62 V92"
      stroke="currentColor"
      strokeWidth={1.5}
      opacity={0.5}
    />
    <circle cx={238} cy={40} r={14} fill={ACCENT} opacity={0.85} />
    <circle cx={264} cy={40} r={14} fill={ACCENT} opacity={0.55} />
  </SceneFrame>
);

// Най-големите договори — a few very tall bars, one hatched (a multi-year estimate).
const TopScene: FC = () => (
  <SceneFrame>
    {[
      [150, 18, 0.9],
      [178, 40, 0.7],
      [206, 54, 0.55],
      [234, 62, 0.45],
      [262, 68, 0.35],
    ].map(([x, y, o]) => (
      <rect
        key={x}
        x={x}
        y={y}
        width={20}
        height={70 - y}
        rx={2}
        fill={ACCENT}
        opacity={o}
      />
    ))}
    <path
      d="M150 26 L170 18 M150 38 L170 30 M150 50 L170 42 M150 62 L170 54"
      stroke={PAPER}
      strokeWidth={2}
      opacity={0.8}
    />
    <path
      d="M144 70 H290"
      stroke="currentColor"
      strokeWidth={1}
      opacity={0.4}
    />
  </SceneFrame>
);

// Всички договори — a ledger of rows with a value column.
const ContractsScene: FC = () => (
  <SceneFrame>
    {Array.from({ length: 5 }, (_, i) => (
      <g key={i}>
        <rect
          x={146}
          y={12 + i * 13}
          width={98}
          height={8}
          rx={1}
          fill={PAPER}
          stroke="currentColor"
          strokeWidth={0.6}
          opacity={0.6}
        />
        <rect
          x={250}
          y={12 + i * 13}
          width={26}
          height={8}
          rx={1}
          fill={ACCENT}
          opacity={0.45 + i * 0.1}
        />
      </g>
    ))}
  </SceneFrame>
);

// Структурите — a ministry block over its five mode columns.
const BodiesScene: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth={0.8} opacity={0.5}>
      {[152, 180, 208, 236, 264].map((x) => (
        <path key={x} d={`M210 34 L${x + 8} 52`} />
      ))}
    </g>
    <rect
      x={190}
      y={14}
      width={40}
      height={20}
      rx={3}
      fill={ACCENT}
      opacity={0.9}
    />
    {[
      [152, 4],
      [180, 2],
      [208, 3],
      [236, 3],
      [264, 2],
    ].map(([x, n]) =>
      Array.from({ length: n }, (_, k) => (
        <rect
          key={`${x}-${k}`}
          x={x}
          y={54 + k * 12}
          width={16}
          height={9}
          rx={1.5}
          fill={PAPER}
          stroke="currentColor"
          strokeWidth={0.8}
          opacity={0.7}
        />
      )),
    )}
  </SceneFrame>
);

// В държавната група — money circling between bodies instead of leaving.
const InGroupScene: FC = () => (
  <SceneFrame>
    <circle
      cx={214}
      cy={52}
      r={34}
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeDasharray="4 3"
      opacity={0.5}
    />
    {[
      [214, 18],
      [248, 52],
      [214, 86],
      [180, 52],
    ].map(([x, y], i) => (
      <circle
        key={i}
        cx={x}
        cy={y}
        r={9}
        fill={ACCENT}
        opacity={0.9 - i * 0.12}
      />
    ))}
    <path
      d="M262 22 L284 10"
      stroke="currentColor"
      strokeWidth={1}
      opacity={0.35}
    />
  </SceneFrame>
);

// Субсидията за влака — a ticket with a coin added on top of the fare.
const SubsidyScene: FC = () => (
  <SceneFrame>
    <rect
      x={150}
      y={40}
      width={84}
      height={40}
      rx={4}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1}
      opacity={0.7}
    />
    <path
      d="M206 40 V80"
      stroke="currentColor"
      strokeWidth={1}
      strokeDasharray="3 3"
      opacity={0.5}
    />
    <circle cx={258} cy={34} r={16} fill={ACCENT} opacity={0.9} />
    <circle cx={270} cy={56} r={12} fill={ACCENT} opacity={0.6} />
  </SceneFrame>
);

// Еврофондове — a grant bar with the paid part filled.
const FundsScene: FC = () => (
  <SceneFrame>
    {[
      [20, 120, 0.85],
      [44, 96, 0.65],
      [68, 70, 0.5],
    ].map(([y, w, o]) => (
      <g key={y}>
        <rect
          x={150}
          y={y}
          width={130}
          height={14}
          rx={3}
          fill={PAPER}
          stroke="currentColor"
          strokeWidth={0.8}
          opacity={0.6}
        />
        <rect
          x={150}
          y={y}
          width={w}
          height={14}
          rx={3}
          fill={ACCENT}
          opacity={o}
        />
      </g>
    ))}
  </SceneFrame>
);

export const TRANSPORT_SCENES: Record<string, FC> = {
  map: MapScene,
  rail: RailScene,
  maritime: MaritimeScene,
  aviation: AviationScene,
  competition: CompetitionScene,
  direct: DirectScene,
  top: TopScene,
  contracts: ContractsScene,
  bodies: BodiesScene,
  ingroup: InGroupScene,
  subsidy: SubsidyScene,
  funds: FundsScene,
};
