// Infographic vignettes for the /culture hub tiles — the same drawing contract as
// fundsScenes.tsx / governanceScenes.tsx (300×116 SceneFrame, ink = currentColor,
// accent = var(--sector), PAPER for under-ink fills; see
// src/ux/infographic/README.md).
//
// One bespoke scene per tile. The rule that makes them worth drawing: a scene
// shows the STRUCTURE its destination is about — a stage, a ranked column, a
// ceiling being touched — not a generic bar chart in a different accent. With the
// labels covered a reader should still be able to tell two tiles apart.
//
// ═══════════════════════════════════════════════════════════════════════════════
// DENSE MARKS STAY OUT OF THE BOTTOM-LEFT. `InfographicTile` overlays the tile's
// `metric` large at the banner's bottom-left behind a radial scrim, so anything
// accent-filled there is either hidden by the number or fighting it. Enforced by
// `cultureScenes.test.tsx`: no `var(--sector)`-filled mark may overlap x < 132 AND
// y > 72. Strokes and PAPER fills may — they sit under the scrim quietly.
// ═══════════════════════════════════════════════════════════════════════════════

/* eslint-disable react-refresh/only-export-components -- CULTURE_SCENES is a lookup
   table of scene components, not a fast-refresh boundary. */
import { type FC } from "react";
import { SceneFrame, PAPER } from "@/ux/infographic";

const ACCENT = "var(--sector)";

// Бюджет на МК — a ministry pediment: columns under an architrave. The structure
// is „one building, appropriated by law", against the corpora below it which are
// counted transaction by transaction.
const BudgetScene: FC = () => (
  <SceneFrame>
    <path d="M150 18 L246 40 L246 48 L150 48 Z" fill={ACCENT} opacity={0.9} />
    {[160, 180, 200, 220, 238].map((x) => (
      <rect
        key={x}
        x={x}
        y={50}
        width={9}
        height={44}
        fill={ACCENT}
        opacity={0.55}
      />
    ))}
    <rect x={148} y={94} width={100} height={7} fill={ACCENT} />
    <path d="M18 96 H130" stroke="currentColor" strokeWidth={1} opacity={0.3} />
  </SceneFrame>
);

// Обществени поръчки — a buyer fanning out to suppliers. One node, many edges:
// the shape a group roll-up has, and the reason the sector needed a register.
const ProcurementScene: FC = () => (
  <SceneFrame>
    <g stroke={ACCENT} strokeWidth={1.4} opacity={0.6} fill="none">
      {[22, 38, 54, 70, 86].map((y, i) => (
        <path
          key={y}
          d={`M172 56 C 200 56, 210 ${y}, 246 ${y}`}
          opacity={0.35 + i * 0.1}
        />
      ))}
    </g>
    <circle cx={168} cy={56} r={11} fill={ACCENT} />
    {[22, 38, 54, 70, 86].map((y) => (
      <circle key={y} cx={250} cy={y} r={4} fill={ACCENT} opacity={0.75} />
    ))}
  </SceneFrame>
);

// Филмови субсидии — a strip of film frames, the perforation running along it.
const SubsidiesScene: FC = () => (
  <SceneFrame>
    <rect
      x={140}
      y={26}
      width={124}
      height={62}
      rx={3}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1.2}
      opacity={0.9}
    />
    {[0, 1, 2].map((i) => (
      <rect
        key={i}
        x={150 + i * 38}
        y={38}
        width={30}
        height={38}
        fill={ACCENT}
        opacity={0.35 + i * 0.2}
      />
    ))}
    {[0, 1, 2, 3, 4, 5].map((i) => (
      <rect
        key={`t${i}`}
        x={146 + i * 20}
        y={29}
        width={8}
        height={5}
        rx={1}
        fill="currentColor"
        opacity={0.35}
      />
    ))}
  </SceneFrame>
);

// Продуценти (films browser) — a ranked column, longest first: the concentration
// the register's top-10 share is about.
const FilmsScene: FC = () => (
  <SceneFrame>
    {[92, 74, 58, 45, 34, 25].map((w, i) => (
      <rect
        key={i}
        x={158}
        y={22 + i * 13}
        width={w}
        height={8}
        rx={2}
        fill={ACCENT}
        opacity={0.85 - i * 0.11}
      />
    ))}
    <path
      d="M152 18 V104"
      stroke="currentColor"
      strokeWidth={1.2}
      opacity={0.45}
    />
  </SceneFrame>
);

// Конкуренция — bidder counts as stacked dots per procedure; the single-bid
// columns are the lone ones. The point is the CONTRAST, so the baseline row is
// drawn in ink and the sector's in accent.
const CompetitionScene: FC = () => (
  <SceneFrame>
    {[1, 3, 1, 4, 2, 1, 5, 1].map((n, col) =>
      Array.from({ length: n }, (_, r) => (
        <circle
          key={`${col}-${r}`}
          cx={150 + col * 15}
          cy={92 - r * 13}
          r={4.2}
          fill={n === 1 ? ACCENT : PAPER}
          stroke={n === 1 ? "none" : "currentColor"}
          strokeWidth={1.1}
          opacity={n === 1 ? 0.95 : 0.8}
        />
      )),
    )}
  </SceneFrame>
);

// Риск — a grade ladder with the flagged rungs filled. Not a gauge: the corpus
// grades A–F and culture reaches only D, so a needle would imply a range that
// does not exist here.
const RiskScene: FC = () => (
  <SceneFrame>
    {["A", "B", "C", "D"].map((_, i) => (
      <rect
        key={i}
        x={156 + i * 26}
        y={30 + i * 12}
        width={20}
        height={64 - i * 12}
        rx={2}
        fill={i >= 2 ? ACCENT : PAPER}
        stroke="currentColor"
        strokeWidth={1.1}
        opacity={i >= 2 ? 0.9 : 0.55}
      />
    ))}
  </SceneFrame>
);

// Процедури — a timeline of published notices, one taller mark where a procedure
// was relaunched after a cancellation.
const TendersScene: FC = () => (
  <SceneFrame>
    <path
      d="M144 88 H262"
      stroke="currentColor"
      strokeWidth={1.2}
      opacity={0.4}
    />
    {[0, 1, 2, 3, 4, 5, 6].map((i) => (
      <rect
        key={i}
        x={150 + i * 16}
        y={i === 4 ? 40 : 62}
        width={7}
        height={i === 4 ? 46 : 24}
        rx={1.5}
        fill={ACCENT}
        opacity={i === 4 ? 0.95 : 0.5}
      />
    ))}
    <circle cx={153.5 + 4 * 16} cy={34} r={3.5} fill={ACCENT} />
  </SceneFrame>
);

// Кой решава — a commission table: seats around a slab. The subject is the
// composition of the body that awards, not the award.
const CommissionsScene: FC = () => (
  <SceneFrame>
    <ellipse
      cx={202}
      cy={62}
      rx={54}
      ry={20}
      fill={PAPER}
      stroke="currentColor"
      strokeWidth={1.3}
      opacity={0.9}
    />
    {[0, 1, 2, 3, 4, 5, 6].map((i) => {
      const a = (Math.PI * 2 * i) / 7 - Math.PI / 2;
      return (
        <circle
          key={i}
          cx={202 + Math.cos(a) * 66}
          cy={62 + Math.sin(a) * 30}
          r={5}
          fill={ACCENT}
          opacity={0.85}
        />
      );
    })}
  </SceneFrame>
);

// Министерството като възложител — the principal above its second-level units.
const AwarderScene: FC = () => (
  <SceneFrame>
    <rect x={186} y={20} width={34} height={18} rx={3} fill={ACCENT} />
    <path
      d="M203 38 V50"
      stroke="currentColor"
      strokeWidth={1.2}
      opacity={0.5}
    />
    <path
      d="M156 50 H250"
      stroke="currentColor"
      strokeWidth={1.2}
      opacity={0.5}
    />
    {[156, 186, 216, 246].map((x) => (
      <g key={x}>
        <path
          d={`M${x} 50 V60`}
          stroke="currentColor"
          strokeWidth={1.2}
          opacity={0.5}
        />
        <rect
          x={x - 11}
          y={60}
          width={22}
          height={14}
          rx={2}
          fill={ACCENT}
          opacity={0.5}
        />
      </g>
    ))}
  </SceneFrame>
);

// Директори — filed declarations: a stack of forms, the top one signed.
const DirectorsScene: FC = () => (
  <SceneFrame>
    {[0, 1, 2].map((i) => (
      <rect
        key={i}
        x={162 + i * 6}
        y={22 + i * 6}
        width={78}
        height={62}
        rx={3}
        fill={PAPER}
        stroke="currentColor"
        strokeWidth={1.2}
        opacity={0.85}
      />
    ))}
    {[0, 1, 2, 3].map((i) => (
      <rect
        key={`l${i}`}
        x={176}
        y={40 + i * 11}
        width={i === 3 ? 26 : 50}
        height={5}
        rx={1.5}
        fill={ACCENT}
        opacity={i === 3 ? 0.95 : 0.45}
      />
    ))}
  </SceneFrame>
);

// Изпълнители — one supplier reaching several buyers. Deliberately the MIRROR of
// ProcurementScene: many nodes converging on one, which is the cross-buyer shape
// an investigation starts from.
const ContractorsScene: FC = () => (
  <SceneFrame>
    <g stroke={ACCENT} strokeWidth={1.4} opacity={0.55} fill="none">
      {[24, 42, 60, 78, 94].map((y) => (
        <path key={y} d={`M158 ${y} C 196 ${y}, 206 58, 240 58`} />
      ))}
    </g>
    {[24, 42, 60, 78, 94].map((y) => (
      <rect
        key={y}
        x={146}
        y={y - 5}
        width={14}
        height={10}
        rx={2}
        fill={ACCENT}
        opacity={0.6}
      />
    ))}
    <circle cx={246} cy={58} r={12} fill={ACCENT} />
  </SceneFrame>
);

export const CULTURE_SCENES: Record<string, FC> = {
  budget: BudgetScene,
  procurement: ProcurementScene,
  subsidies: SubsidiesScene,
  films: FilmsScene,
  competition: CompetitionScene,
  risk: RiskScene,
  tenders: TendersScene,
  commissions: CommissionsScene,
  awarder: AwarderScene,
  directors: DirectorsScene,
  contractors: ContractorsScene,
};
