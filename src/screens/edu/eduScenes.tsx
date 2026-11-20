// Infographic vignettes for the /sector/edu hub tiles — the drawing contract of
// transportScenes.tsx (300×116 SceneFrame, ink = currentColor, accent =
// var(--sector), PAPER for under-ink fills). One scene per tile, keyed by the
// tile id in eduRegistry.ts.
//
// DENSE MARKS STAY OUT OF THE BOTTOM-LEFT: the tile's metric is overlaid there.
// `eduScenes.test.tsx` fails any `var(--sector)`-filled mark overlapping
// x < 132 AND y > 72.

/* eslint-disable react-refresh/only-export-components -- EDU_SCENES is a
   lookup table of scene components, not a fast-refresh boundary. */
import { type FC } from "react";
import { SceneFrame, PAPER } from "@/ux/infographic";

const ACCENT = "var(--sector)";

// Университетите — a columned building with a pediment.
const UniversitiesScene: FC = () => (
  <SceneFrame>
    <path
      d="M160 44 L216 18 L272 44 Z"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1.2}
    />
    {[0, 1, 2, 3, 4].map((i) => (
      <rect
        key={i}
        x={166 + i * 22}
        y={50}
        width={10}
        height={36}
        rx={1}
        fill={ACCENT}
        opacity={0.85 - i * 0.08}
      />
    ))}
    <path d="M154 90 H278" stroke="currentColor" strokeWidth={2} />
  </SceneFrame>
);

// Министерството — one tall block with a flag.
const MinistryScene: FC = () => (
  <SceneFrame>
    <rect
      x={180}
      y={30}
      width={72}
      height={60}
      rx={2}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1.2}
    />
    {[0, 1, 2].map((r) =>
      [0, 1, 2].map((c) => (
        <rect
          key={`${r}-${c}`}
          x={190 + c * 20}
          y={40 + r * 16}
          width={10}
          height={9}
          fill={ACCENT}
          opacity={0.7}
        />
      )),
    )}
    <path d="M216 30 V12" stroke="currentColor" strokeWidth={1.2} />
    <rect x={216} y={12} width={18} height={10} fill={ACCENT} />
  </SceneFrame>
);

// БАН — an atom: a nucleus and three orbits.
const BanScene: FC = () => (
  <SceneFrame>
    {[0, 60, 120].map((a) => (
      <ellipse
        key={a}
        cx={216}
        cy={56}
        rx={52}
        ry={16}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        opacity={0.5}
        transform={`rotate(${a} 216 56)`}
      />
    ))}
    <circle cx={216} cy={56} r={8} fill={ACCENT} />
    <circle cx={262} cy={46} r={4} fill={ACCENT} opacity={0.7} />
    <circle cx={190} cy={22} r={4} fill={ACCENT} opacity={0.7} />
  </SceneFrame>
);

// Всички институции — a grid of small buildings, one highlighted per row.
const BodiesScene: FC = () => (
  <SceneFrame>
    {[0, 1, 2].map((r) =>
      [0, 1, 2, 3, 4].map((c) => (
        <rect
          key={`${r}-${c}`}
          x={152 + c * 26}
          y={20 + r * 24}
          width={18}
          height={16}
          rx={2}
          fill={c === (r * 2) % 5 ? ACCENT : PAPER}
          stroke="currentColor"
          strokeWidth={0.8}
          opacity={c === (r * 2) % 5 ? 0.9 : 0.6}
        />
      )),
    )}
  </SceneFrame>
);

// Конкуренция — envelopes: one lone bid against a stack.
const CompetitionScene: FC = () => (
  <SceneFrame>
    {[0, 1, 2, 3].map((i) => (
      <rect
        key={i}
        x={150 + i * 6}
        y={28 + i * 6}
        width={44}
        height={30}
        rx={2}
        fill={PAPER}
        stroke="currentColor"
        strokeWidth={1}
        opacity={0.5}
      />
    ))}
    <rect x={232} y={36} width={48} height={32} rx={2} fill={ACCENT} />
    <path
      d="M232 36 L256 54 L280 36"
      fill="none"
      stroke={PAPER}
      strokeWidth={1.5}
    />
  </SceneFrame>
);

// Училищните автобуси — a bus with windows and wheels.
const BusesScene: FC = () => (
  <SceneFrame>
    <rect x={160} y={34} width={120} height={42} rx={8} fill={ACCENT} />
    {[0, 1, 2, 3, 4].map((i) => (
      <rect
        key={i}
        x={168 + i * 22}
        y={42}
        width={16}
        height={14}
        rx={2}
        fill={PAPER}
      />
    ))}
    {[184, 256].map((x) => (
      <circle
        key={x}
        cx={x}
        cy={78}
        r={8}
        fill={PAPER}
        stroke="currentColor"
        strokeWidth={2}
      />
    ))}
  </SceneFrame>
);

// Най-големите поръчки — descending bars, the first split into lots.
const TopScene: FC = () => (
  <SceneFrame>
    {[
      [20, 120, 0.9],
      [40, 88, 0.65],
      [60, 64, 0.5],
      [80, 44, 0.4],
    ].map(([y, w, o]) => (
      <rect
        key={y}
        x={150}
        y={y}
        width={w}
        height={12}
        rx={2}
        fill={ACCENT}
        opacity={o}
      />
    ))}
    {[180, 210, 240].map((x) => (
      <path key={x} d={`M${x} 20 V32`} stroke={PAPER} strokeWidth={2} />
    ))}
  </SceneFrame>
);

// Учебниците — a row of book spines.
const TextbooksScene: FC = () => (
  <SceneFrame>
    {[0, 1, 2, 3, 4, 5].map((i) => (
      <rect
        key={i}
        x={156 + i * 20}
        y={30 + (i % 3) * 6}
        width={16}
        height={60 - (i % 3) * 6}
        rx={2}
        fill={i < 2 ? ACCENT : PAPER}
        stroke="currentColor"
        strokeWidth={0.8}
        opacity={i < 2 ? 0.9 : 0.6}
      />
    ))}
    <path d="M150 90 H284" stroke="currentColor" strokeWidth={1.5} />
  </SceneFrame>
);

// Бюджетът на МОН — stacked yearly columns.
const BudgetScene: FC = () => (
  <SceneFrame>
    {[40, 46, 50, 58, 64, 72].map((h, i) => (
      <rect
        key={i}
        x={156 + i * 20}
        y={90 - h}
        width={14}
        height={h}
        rx={1.5}
        fill={ACCENT}
        opacity={0.45 + i * 0.09}
      />
    ))}
    <path d="M150 90 H284" stroke="currentColor" strokeWidth={1.2} />
  </SceneFrame>
);

// Еврофондове — a ring of stars around a coin.
const FundsScene: FC = () => (
  <SceneFrame>
    {Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return (
        <circle
          key={i}
          cx={Math.round(216 + Math.cos(a) * 36)}
          cy={Math.round(54 + Math.sin(a) * 36)}
          r={3}
          fill={ACCENT}
        />
      );
    })}
    <circle
      cx={216}
      cy={54}
      r={16}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1.2}
    />
  </SceneFrame>
);

// Науката — a flask with liquid.
const ResearchScene: FC = () => (
  <SceneFrame>
    <path
      d="M204 18 V44 L180 90 H252 L228 44 V18 Z"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1.2}
    />
    <path d="M188 74 L180 90 H252 L244 74 Z" fill={ACCENT} />
    <circle cx={214} cy={62} r={3} fill={ACCENT} opacity={0.6} />
    <circle cx={222} cy={54} r={2} fill={ACCENT} opacity={0.5} />
  </SceneFrame>
);

// Училищата и матурите — a mortarboard over a sheet.
const SchoolsScene: FC = () => (
  <SceneFrame>
    <rect
      x={176}
      y={52}
      width={80}
      height={40}
      rx={2}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1}
    />
    {[62, 72, 82].map((y) => (
      <path
        key={y}
        d={`M186 ${y} H246`}
        stroke="currentColor"
        strokeWidth={1}
        opacity={0.4}
      />
    ))}
    <path d="M176 30 L216 16 L256 30 L216 44 Z" fill={ACCENT} />
    <path d="M256 30 V46" stroke="currentColor" strokeWidth={1.2} />
    <circle cx={256} cy={48} r={3} fill={ACCENT} />
  </SceneFrame>
);

export const EDU_SCENES: Record<string, FC> = {
  universities: UniversitiesScene,
  ministry: MinistryScene,
  ban: BanScene,
  bodies: BodiesScene,
  competition: CompetitionScene,
  buses: BusesScene,
  top: TopScene,
  textbooks: TextbooksScene,
  budget: BudgetScene,
  funds: FundsScene,
  research: ResearchScene,
  schools: SchoolsScene,
};
