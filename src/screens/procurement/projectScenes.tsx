// Bespoke infographic scenes for the project-dossier hub tiles — one per flagship
// project, each drawing that project's single most recognizable feature (the Струма
// viaducts, the Хемус unbuilt gap, the IGB pipeline, …). Same SceneFrame contract
// as the sector scenes (see src/ux/infographic/README.md): ink = currentColor
// (flips light/dark), the one accent = var(--sector), PAPER for under-ink fills;
// 300×116 viewBox, decorative (aria-hidden via the frame). No stat overlay on these
// tiles, so the whole canvas is usable.

/* eslint-disable react-refresh/only-export-components -- PROJECT_SCENES is a
   lookup table of scene components, not a fast-refresh boundary. */
import { FC } from "react";
import { SceneFrame, PAPER } from "@/ux/infographic";

// 1. Хемус — the longest motorway, unbuilt for decades: two finished ends with a
// dashed gap (the ~250 km missing middle) + a warning marker.
const HemusMotorway: FC = () => (
  <SceneFrame>
    <rect
      x="20"
      y="62"
      width="86"
      height="24"
      rx="4"
      fill="var(--sector)"
      opacity=".85"
    />
    <rect
      x="194"
      y="62"
      width="86"
      height="24"
      rx="4"
      fill="var(--sector)"
      opacity=".85"
    />
    {[30, 52, 74, 96, 204, 226, 248, 270].map((x) => (
      <rect key={x} x={x} y="72" width="10" height="4" rx="2" fill={PAPER} />
    ))}
    <rect
      x="110"
      y="62"
      width="80"
      height="24"
      rx="4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeDasharray="5 5"
      opacity=".55"
    />
    {/* warning marker at the gap */}
    <path d="M150 40 l11 20 h-22 Z" fill="var(--sector)" />
    <rect x="148.5" y="47" width="3" height="7" rx="1.5" fill={PAPER} />
    <circle cx="150" cy="57" r="1.6" fill={PAPER} />
  </SceneFrame>
);

// 2. Западна дъга — the ring road's western ARC: a curved road band + an
// interchange flyover crossing under the apex.
const RingArc: FC = () => (
  <SceneFrame>
    <path
      d="M30 104 A118 118 0 0 1 270 104"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="15"
      strokeLinecap="round"
      opacity=".85"
    />
    <path
      d="M30 104 A118 118 0 0 1 270 104"
      fill="none"
      stroke={PAPER}
      strokeWidth="1.6"
      strokeDasharray="7 8"
    />
    {/* a crossing road (flyover) under the apex */}
    <path
      d="M104 44 h92"
      stroke="currentColor"
      strokeWidth="7"
      strokeLinecap="round"
    />
  </SceneFrame>
);

// 3. Струма (Кресна) — the gorge signature: a tall-pier viaduct beside a tunnel
// portal cut into the mountain.
const StrumaViaduct: FC = () => (
  <SceneFrame>
    {/* gorge walls */}
    <path d="M0 116 L36 40 L70 116 Z" fill="currentColor" opacity=".12" />
    <path d="M226 116 L270 34 L300 116 Z" fill="currentColor" opacity=".16" />
    {/* viaduct deck + tall piers */}
    <path d="M28 62 H196" stroke="currentColor" strokeWidth="3.4" />
    {[54, 92, 130, 168].map((x) => (
      <path key={x} d={`M${x} 63 V104`} stroke="currentColor" strokeWidth="2" />
    ))}
    {/* tunnel portal in the right mountain */}
    <path
      d="M234 104 V80 A22 22 0 0 1 278 80 V104 Z"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <path
      d="M234 80 A22 22 0 0 1 278 80"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="3.2"
    />
  </SceneFrame>
);

// 4. Софийско метро — a metro car head-on with the "M" badge.
const MetroTrain: FC = () => (
  <SceneFrame>
    <path
      d="M52 116 V72 A56 34 0 0 1 246 72 V116"
      fill="currentColor"
      opacity=".1"
    />
    <rect
      x="120"
      y="44"
      width="88"
      height="60"
      rx="12"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <rect
      x="132"
      y="54"
      width="28"
      height="24"
      rx="4"
      fill="currentColor"
      opacity=".28"
    />
    <rect
      x="168"
      y="54"
      width="28"
      height="24"
      rx="4"
      fill="currentColor"
      opacity=".28"
    />
    <rect x="120" y="88" width="88" height="8" rx="3" fill="var(--sector)" />
    <circle cx="138" cy="99" r="3" fill="currentColor" opacity=".5" />
    <circle cx="190" cy="99" r="3" fill="currentColor" opacity=".5" />
    {/* M badge */}
    <circle cx="70" cy="52" r="22" fill="var(--sector)" />
    <path
      d="M60 62 V42 L70 54 L80 42 V62"
      fill="none"
      stroke={PAPER}
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </SceneFrame>
);

// 5. жп Елин Пелин – Костенец — the Zheleznitsa tunnel: a rail-tunnel portal with
// tracks converging into it.
const RailTunnel: FC = () => (
  <SceneFrame>
    <path d="M118 104 L206 26 L296 104 Z" fill="currentColor" opacity=".14" />
    {/* tunnel portal */}
    <path
      d="M176 104 V74 A30 30 0 0 1 236 74 V104 Z"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <path
      d="M176 74 A30 30 0 0 1 236 74"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="3.2"
    />
    {/* converging rails */}
    <path d="M40 108 L196 100" stroke="currentColor" strokeWidth="2" />
    <path d="M74 108 L216 100" stroke="currentColor" strokeWidth="2" />
    {/* sleepers */}
    {[
      [46, 96],
      [70, 92],
      [96, 89],
      [124, 86],
      [152, 83],
    ].map(([x, w], i) => (
      <rect
        key={i}
        x={x}
        y={107 - i * 2.4}
        width={w}
        height="3"
        rx="1.5"
        fill="currentColor"
        opacity=".35"
      />
    ))}
  </SceneFrame>
);

// 6. Газов интерконектор IGB — a gas pipeline with a valve wheel + a GR↔BG link.
const GasPipeline: FC = () => (
  <SceneFrame>
    <rect
      x="20"
      y="66"
      width="260"
      height="22"
      rx="11"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="1.8"
    />
    {/* flanges */}
    {[92, 208].map((x) => (
      <rect
        key={x}
        x={x}
        y="60"
        width="6"
        height="34"
        rx="2"
        fill="currentColor"
        opacity=".4"
      />
    ))}
    {/* valve stem + handwheel */}
    <path d="M150 66 V44" stroke="currentColor" strokeWidth="3" />
    <circle
      cx="150"
      cy="38"
      r="13"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="3.4"
    />
    <path
      d="M137 38 h26 M150 25 v26"
      stroke="var(--sector)"
      strokeWidth="2.4"
    />
    {/* flow highlight */}
    <path
      d="M32 77 H268"
      stroke="var(--sector)"
      strokeWidth="2"
      opacity=".5"
      strokeDasharray="10 8"
    />
  </SceneFrame>
);

// 7. Саниране — a panel apartment block half-wrapped in external insulation.
const Insulation: FC = () => (
  <SceneFrame>
    <rect
      x="92"
      y="22"
      width="116"
      height="82"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="1.8"
    />
    {/* window grid */}
    {[0, 1, 2, 3].map((r) =>
      [0, 1, 2].map((c) => (
        <rect
          key={`${r}-${c}`}
          x={102 + c * 34}
          y={32 + r * 18}
          width="20"
          height="12"
          rx="1.5"
          fill="currentColor"
          opacity=".26"
        />
      )),
    )}
    {/* insulation cladding wrapping the right half */}
    <rect
      x="158"
      y="22"
      width="50"
      height="82"
      fill="var(--sector)"
      opacity=".22"
    />
    <path d="M158 22 V104" stroke="var(--sector)" strokeWidth="2.4" />
    <rect
      x="204"
      y="22"
      width="8"
      height="82"
      fill="var(--sector)"
      opacity=".85"
    />
  </SceneFrame>
);

// 8. Граф Игнатиево — an F-16 fighter jet over a runway.
const FighterJet: FC = () => (
  <SceneFrame>
    {/* runway receding, dashed centerline */}
    <path
      d="M20 112 L120 112 L168 62 L150 62 Z"
      fill="currentColor"
      opacity=".12"
    />
    <path
      d="M40 108 L156 64"
      stroke={PAPER}
      strokeWidth="2"
      strokeDasharray="9 8"
    />
    {/* jet (top view, climbing up-right) */}
    <g fill="var(--sector)">
      <path d="M262 26 L238 60 L214 78 L232 62 L206 66 L232 56 L214 44 L238 52 Z" />
      <circle cx="250" cy="40" r="3" fill={PAPER} />
    </g>
  </SceneFrame>
);

// 9. Национална детска болница — the decades-stalled build: a dashed pit + a tower
// crane, with a hospital cross.
const HospitalPit: FC = () => (
  <SceneFrame>
    <path
      d="M20 96 H120 M186 96 H288"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    {/* the pit (дупка) */}
    <path
      d="M120 96 L138 112 H168 L186 96"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeDasharray="5 5"
      opacity=".6"
    />
    {/* tower crane */}
    <g stroke="currentColor" strokeWidth="2" fill="none">
      <path d="M74 96 V26 M56 30 H196" />
      <path d="M74 26 L92 40 M74 26 L56 40" />
      <path d="M170 30 V50" />
    </g>
    <rect
      x="166"
      y="50"
      width="8"
      height="6"
      fill="currentColor"
      opacity=".5"
    />
    {/* hospital cross */}
    <g fill="var(--sector)">
      <rect x="224" y="40" width="40" height="40" rx="6" opacity=".2" />
      <rect x="240" y="46" width="8" height="28" rx="2" />
      <rect x="230" y="56" width="28" height="8" rx="2" />
    </g>
  </SceneFrame>
);

// 10. Машинно гласуване (СУЕМГ) — a voting terminal with a check on screen + the
// printed paper receipt (the paper trail).
const VotingMachine: FC = () => (
  <SceneFrame>
    {/* result tallies (context) */}
    <rect
      x="24"
      y="46"
      width="58"
      height="8"
      rx="4"
      fill="var(--sector)"
      opacity=".85"
    />
    <rect
      x="24"
      y="62"
      width="42"
      height="8"
      rx="4"
      fill="currentColor"
      opacity=".3"
    />
    <rect
      x="24"
      y="78"
      width="30"
      height="8"
      rx="4"
      fill="currentColor"
      opacity=".25"
    />
    {/* terminal */}
    <rect
      x="120"
      y="30"
      width="96"
      height="70"
      rx="8"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <rect
      x="132"
      y="40"
      width="72"
      height="42"
      rx="3"
      fill="currentColor"
      opacity=".1"
    />
    <path
      d="M150 61 l9 10 l19 -22"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* printed receipt slipping out */}
    <rect
      x="150"
      y="96"
      width="36"
      height="20"
      rx="2"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="1.4"
    />
    {[102, 107, 112].map((y) => (
      <path
        key={y}
        d={`M156 ${y} h24`}
        stroke="currentColor"
        strokeWidth="1.4"
        opacity=".4"
      />
    ))}
  </SceneFrame>
);

// A shared water-cycle motif: an open trench with a big laid pipe (cross-section).
const WaterCore: FC = () => (
  <>
    <path
      d="M20 92 H108 M192 92 H236"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <path
      d="M108 92 L124 110 H176 L192 92"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      opacity=".5"
    />
    {/* pipe body + cross-section */}
    <rect
      x="70"
      y="70"
      width="120"
      height="30"
      rx="6"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <ellipse
      cx="70"
      cy="85"
      rx="12"
      ry="15"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <ellipse cx="70" cy="85" rx="6" ry="8" fill="var(--sector)" opacity=".85" />
  </>
);

// 11. Воден цикъл (ВиК) — the trench + pipe, with a water drop.
const WaterTrench: FC = () => (
  <SceneFrame>
    <WaterCore />
    <path
      d="M244 40 c10 12 14 18 14 25 a14 14 0 0 1 -28 0 c0 -7 4 -13 14 -25 Z"
      fill="var(--sector)"
      opacity=".85"
    />
  </SceneFrame>
);

// 12. Воден цикъл по ОПОС (ИСУН) — the same works, marked by the EU 12-star ring
// (the EU-financing differentiator).
const WaterEuFunded: FC = () => {
  const stars = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
    return [246 + Math.cos(a) * 26, 52 + Math.sin(a) * 26] as const;
  });
  return (
    <SceneFrame>
      <WaterCore />
      {stars.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.6" fill="var(--sector)" />
      ))}
    </SceneFrame>
  );
};

export const PROJECT_SCENES: Record<string, FC> = {
  hemus: HemusMotorway,
  ringArc: RingArc,
  struma: StrumaViaduct,
  metro: MetroTrain,
  railTunnel: RailTunnel,
  gasPipe: GasPipeline,
  insulation: Insulation,
  jet: FighterJet,
  hospitalPit: HospitalPit,
  votingMachine: VotingMachine,
  waterTrench: WaterTrench,
  waterEu: WaterEuFunded,
};
