// Bespoke per-sector infographic vignettes for the /governance/sectors hub —
// deliberately NOT icons. Each is a small "scene" (a highway + km bars, a pulse
// line into a hospital cross, rising coin stacks, a container ship…) that hints
// at what the sector's dashboard actually measures.
//
// Every scene renders inside <SceneFrame> (src/ux/infographic), which owns the
// drawing contract: fixed 300×116 viewBox, ink via `currentColor`, the accent
// via `var(--sector)` (set by the tile), and `PAPER` for under-ink fills so they
// read on both the cream and navy ground. Scenes are decorative — the frame is
// aria-hidden; the tile's visible title is the label.

/* eslint-disable react-refresh/only-export-components -- SECTOR_SCENES is a
   lookup table of scene components, not a fast-refresh boundary. */
import { FC } from "react";
import { SceneFrame, PAPER } from "@/ux/infographic";

const Roads: FC = () => (
  <SceneFrame>
    <path
      d="M120 20 L180 20 L270 108 L30 108 Z"
      fill="var(--sector)"
      opacity=".12"
    />
    <g fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".85">
      <path d="M30 108 L120 20 M270 108 L180 20" />
    </g>
    <path
      d="M150 24 L150 104"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="3"
      strokeDasharray="8 9"
      strokeLinecap="round"
    />
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M196 62 q14 -16 28 0 M224 62 q14 -16 28 0" />
      <path d="M196 62 v14 M224 62 v14 M252 62 v14" />
    </g>
    <g fill="var(--sector)">
      <rect x="34" y="86" width="9" height="18" rx="2" opacity=".55" />
      <rect x="47" y="78" width="9" height="26" rx="2" opacity=".75" />
      <rect x="60" y="70" width="9" height="34" rx="2" />
    </g>
  </SceneFrame>
);

const Water: FC = () => (
  <SceneFrame>
    <path
      d="M0 74 q30 -12 60 0 t60 0 t60 0 t60 0 t60 0 V116 H0 Z"
      fill="var(--sector)"
      opacity=".18"
    />
    <path
      d="M0 84 q30 -12 60 0 t60 0 t60 0 t60 0 t60 0"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="2"
    />
    <path
      d="M150 20 c14 18 22 28 22 40 a22 22 0 0 1 -44 0 c0 -12 8 -22 22 -40 Z"
      fill="var(--sector)"
      opacity=".85"
    />
    <path
      d="M142 60 a12 12 0 0 0 8 8"
      fill="none"
      stroke={PAPER}
      strokeWidth="2"
      strokeLinecap="round"
    />
    <g transform="translate(46 40)">
      <path
        d="M-16 8 a20 20 0 0 1 32 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        opacity=".35"
      />
      <path
        d="M-16 8 a20 20 0 0 1 22 -17"
        fill="none"
        stroke="var(--sector)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </g>
    <rect
      x="228"
      y="66"
      width="52"
      height="12"
      rx="3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      opacity=".7"
    />
    <rect
      x="246"
      y="60"
      width="8"
      height="6"
      fill="currentColor"
      opacity=".5"
    />
  </SceneFrame>
);

const Transport: FC = () => (
  <SceneFrame>
    {/* receding rails */}
    <g fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".5">
      <path d="M110 108 L150 34 M210 108 L172 34" />
      <path d="M118 92 H202 M126 76 H194 M134 60 H186" opacity=".7" />
    </g>
    {/* locomotive */}
    <g transform="translate(38 40)">
      <path
        d="M0 8 h44 a10 10 0 0 1 10 10 v22 h-54 Z"
        fill="var(--sector)"
        opacity=".9"
      />
      <rect x="8" y="14" width="14" height="12" rx="2" fill={PAPER} />
      <rect x="30" y="14" width="16" height="12" rx="2" fill={PAPER} />
      <circle
        cx="12"
        cy="46"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      />
      <circle
        cx="42"
        cy="46"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      />
    </g>
    {/* modal dots: rail / port / air */}
    <g fill="var(--sector)">
      <circle cx="236" cy="34" r="4" />
      <circle cx="252" cy="34" r="4" opacity=".6" />
      <circle cx="268" cy="34" r="4" opacity=".35" />
    </g>
    {/* anchor hint */}
    <g
      transform="translate(250 60)"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
      opacity=".55"
    >
      <circle cx="0" cy="0" r="3" />
      <path
        d="M0 3 v20 M-9 20 a9 9 0 0 0 18 0 M-7 8 h14"
        strokeLinecap="round"
      />
    </g>
  </SceneFrame>
);

const Energy: FC = () => (
  <SceneFrame>
    {/* catenary transmission lines sagging across the frame */}
    <g fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".5">
      <path d="M70 40 q70 26 140 6 t78 -4" />
      <path d="M70 54 q70 28 140 10 t78 -2" opacity=".7" />
    </g>
    {/* lattice pylon */}
    <g stroke="currentColor" strokeWidth="1.6" fill="none" opacity=".85">
      <path d="M52 104 L66 28 M84 104 L70 28" />
      <path d="M46 40 h44 M50 54 h36" />
      <path d="M58 96 L78 82 M78 96 L58 82 M60 78 L76 66 M76 78 L60 66 M62 60 L74 50 M74 60 L62 50" />
    </g>
    {/* insulator hang points */}
    <g fill="var(--sector)">
      <circle cx="46" cy="40" r="2.4" />
      <circle cx="90" cy="40" r="2.4" />
    </g>
    {/* lightning bolt — the focal */}
    <path
      d="M214 28 L200 60 L211 60 L198 94 L230 54 L217 54 Z"
      fill="var(--sector)"
      opacity=".9"
    />
    {/* generation bars */}
    <g fill="var(--sector)">
      <rect x="250" y="82" width="9" height="20" rx="2" opacity=".55" />
      <rect x="263" y="72" width="9" height="30" rx="2" opacity=".78" />
      <rect x="276" y="62" width="9" height="40" rx="2" />
    </g>
  </SceneFrame>
);

const Pension: FC = () => (
  <SceneFrame>
    <g fill="var(--sector)">
      <g opacity=".55">
        <ellipse cx="60" cy="98" rx="20" ry="6" />
        <ellipse cx="60" cy="90" rx="20" ry="6" />
        <ellipse cx="60" cy="82" rx="20" ry="6" />
      </g>
      <g opacity=".72">
        <ellipse cx="108" cy="98" rx="20" ry="6" />
        <ellipse cx="108" cy="90" rx="20" ry="6" />
        <ellipse cx="108" cy="82" rx="20" ry="6" />
        <ellipse cx="108" cy="74" rx="20" ry="6" />
      </g>
      <g>
        <ellipse cx="156" cy="98" rx="20" ry="6" />
        <ellipse cx="156" cy="90" rx="20" ry="6" />
        <ellipse cx="156" cy="82" rx="20" ry="6" />
        <ellipse cx="156" cy="74" rx="20" ry="6" />
        <ellipse cx="156" cy="66" rx="20" ry="6" />
      </g>
    </g>
    <path
      d="M40 60 L96 48 L150 38 L214 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M214 22 l-11 1 M214 22 l1 11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <text
      x="230"
      y="30"
      fill="var(--sector)"
      fontSize="15"
      fontWeight="700"
      fontFamily="Georgia, serif"
    >
      €
    </text>
  </SceneFrame>
);

const Social: FC = () => (
  <SceneFrame>
    {/* safety-net arc = social protection (distinct from НОИ's pension scene) */}
    <path
      d="M92 30 a58 34 0 0 1 116 0"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="3"
      opacity=".85"
    />
    <g stroke="var(--sector)" strokeWidth="1.2" opacity=".45">
      <path d="M110 30 l14 14 M134 30 l14 14 M150 30 l14 14 M176 30 l14 14" />
    </g>
    {/* heart cradled above a supporting hand = грижа / подпомагане */}
    <path
      d="M150 58 c-6 -11 -22 -7 -22 5 c0 9 13 16 22 23 c9 -7 22 -14 22 -23 c0 -12 -16 -16 -22 -5 Z"
      fill="var(--sector)"
    />
    {/* the supporting cupping hand */}
    <path
      d="M112 90 q38 24 76 0"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <g fill="currentColor" opacity=".8">
      <circle cx="112" cy="90" r="4" />
      <circle cx="131" cy="98" r="4" />
      <circle cx="150" cy="101" r="4" />
      <circle cx="169" cy="98" r="4" />
      <circle cx="188" cy="90" r="4" />
    </g>
  </SceneFrame>
);

const Health: FC = () => (
  <SceneFrame>
    <path
      d="M0 66 H70 L84 40 L100 92 L116 58 H150"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <rect
      x="164"
      y="34"
      width="60"
      height="60"
      rx="12"
      fill="var(--sector)"
      opacity=".9"
    />
    <g fill={PAPER}>
      <rect x="188" y="44" width="12" height="40" rx="3" />
      <rect x="174" y="58" width="40" height="12" rx="3" />
    </g>
    <g fill="currentColor" opacity=".5">
      <rect x="240" y="72" width="8" height="22" rx="2" />
      <rect x="252" y="60" width="8" height="34" rx="2" />
      <rect x="264" y="66" width="8" height="28" rx="2" />
    </g>
  </SceneFrame>
);

const Edu: FC = () => (
  <SceneFrame>
    <path
      d="M60 44 L118 24 L176 44 L118 64 Z"
      fill="var(--sector)"
      opacity=".9"
    />
    <path
      d="M118 64 L118 82 M90 54 L90 78 a28 12 0 0 0 56 0 L146 54"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
    <circle cx="176" cy="44" r="3.4" fill="currentColor" />
    <path d="M176 44 L182 74" stroke="currentColor" strokeWidth="1.6" />
    <g fill="var(--sector)">
      <rect x="206" y="82" width="12" height="20" rx="2" opacity=".5" />
      <rect x="222" y="70" width="12" height="32" rx="2" opacity=".7" />
      <rect x="238" y="58" width="12" height="44" rx="2" opacity=".88" />
      <rect x="254" y="46" width="12" height="56" rx="2" />
    </g>
  </SceneFrame>
);

const Schools: FC = () => (
  <SceneFrame>
    {/* school facade: pediment + columns */}
    <path d="M70 40 L118 20 L166 40 Z" fill="var(--sector)" opacity=".85" />
    <rect
      x="70"
      y="40"
      width="96"
      height="6"
      fill="currentColor"
      opacity=".55"
    />
    <g fill="currentColor" opacity=".5">
      <rect x="78" y="48" width="8" height="48" />
      <rect x="98" y="48" width="8" height="48" />
      <rect x="118" y="48" width="8" height="48" />
      <rect x="138" y="48" width="8" height="48" />
      <rect x="150" y="48" width="8" height="48" />
    </g>
    <rect
      x="70"
      y="98"
      width="96"
      height="6"
      fill="currentColor"
      opacity=".55"
    />
    {/* matura grade badge */}
    <g transform="translate(224 56)">
      <circle r="26" fill="var(--sector)" opacity=".9" />
      <text
        x="0"
        y="9"
        textAnchor="middle"
        fill={PAPER}
        fontSize="26"
        fontWeight="700"
        fontFamily="Georgia, serif"
      >
        6
      </text>
    </g>
  </SceneFrame>
);

const Revenue: FC = () => (
  <SceneFrame>
    <path
      d="M40 20 h74 v72 l-9 -6 -9 6 -9 -6 -9 6 -9 -6 -9 6 -9 -6 -12 6 Z"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <g stroke="var(--sector)" strokeWidth="3" strokeLinecap="round">
      <path d="M52 36 h50 M52 48 h50 M52 60 h32" />
    </g>
    <g fill="var(--sector)">
      <rect x="150" y="76" width="14" height="24" rx="2" opacity=".5" />
      <rect x="170" y="62" width="14" height="38" rx="2" opacity=".7" />
      <rect x="190" y="48" width="14" height="52" rx="2" opacity=".9" />
    </g>
    <circle cx="248" cy="46" r="24" fill="var(--sector)" opacity=".85" />
    <text
      x="248"
      y="53"
      textAnchor="middle"
      fill={PAPER}
      fontSize="20"
      fontWeight="700"
      fontFamily="Georgia, serif"
    >
      %
    </text>
  </SceneFrame>
);

const Customs: FC = () => (
  <SceneFrame>
    <path
      d="M0 92 q40 10 80 0 t80 0 t80 0 t60 0"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="2"
      opacity=".8"
    />
    <path d="M42 74 h150 l-16 20 h-118 Z" fill="currentColor" opacity=".82" />
    <g>
      <rect
        x="60"
        y="46"
        width="30"
        height="20"
        rx="2"
        fill="var(--sector)"
        opacity=".9"
      />
      <rect
        x="92"
        y="46"
        width="30"
        height="20"
        rx="2"
        fill="var(--sector)"
        opacity=".55"
      />
      <rect
        x="124"
        y="46"
        width="30"
        height="20"
        rx="2"
        fill="var(--sector)"
        opacity=".75"
      />
      <rect
        x="76"
        y="24"
        width="30"
        height="20"
        rx="2"
        fill="var(--sector)"
        opacity=".7"
      />
      <rect
        x="108"
        y="24"
        width="30"
        height="20"
        rx="2"
        fill="var(--sector)"
        opacity=".95"
      />
    </g>
    <path
      d="M228 40 v40 M214 80 h28"
      stroke="currentColor"
      strokeWidth="2"
      opacity=".6"
    />
    <path d="M228 44 l24 8 l-24 8 Z" fill="var(--sector)" opacity=".7" />
  </SceneFrame>
);

const Administration: FC = () => (
  <SceneFrame>
    {/* institution: pediment + columns */}
    <path d="M40 42 L86 22 L132 42 Z" fill="currentColor" opacity=".55" />
    <g fill="currentColor" opacity=".45">
      <rect x="48" y="50" width="8" height="44" />
      <rect x="68" y="50" width="8" height="44" />
      <rect x="88" y="50" width="8" height="44" />
      <rect x="108" y="50" width="8" height="44" />
    </g>
    <rect
      x="40"
      y="50"
      width="84"
      height="5"
      fill="currentColor"
      opacity=".55"
    />
    <rect
      x="40"
      y="96"
      width="84"
      height="5"
      fill="currentColor"
      opacity=".55"
    />
    {/* e-government node network */}
    <g stroke="var(--sector)" strokeWidth="2" opacity=".7">
      <path d="M176 40 L214 30 M176 40 L206 70 M214 30 L252 52 M206 70 L252 52 M206 70 L232 88" />
    </g>
    <g fill="var(--sector)">
      <circle cx="176" cy="40" r="5" />
      <circle cx="214" cy="30" r="5" />
      <circle cx="252" cy="52" r="5" />
      <circle cx="206" cy="70" r="5" />
      <circle cx="232" cy="88" r="4" opacity=".7" />
    </g>
    {/* click / service check */}
    <path
      d="M198 46 l6 6 l12 -12"
      fill="none"
      stroke={PAPER}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </SceneFrame>
);

const Defense: FC = () => (
  <SceneFrame>
    <path
      d="M96 20 l40 12 v26 c0 26 -22 38 -40 46 c-18 -8 -40 -20 -40 -46 V32 Z"
      fill="var(--sector)"
      opacity=".16"
      stroke="var(--sector)"
      strokeWidth="2"
    />
    <path
      d="M96 40 l0 44 M78 62 h36"
      stroke="var(--sector)"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <g transform="translate(214 62)">
      <circle
        r="34"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        opacity=".35"
      />
      <circle
        r="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        opacity=".35"
      />
      <path
        d="M0 0 L28 -18 A34 34 0 0 0 34 0 Z"
        fill="var(--sector)"
        opacity=".5"
      />
      <circle r="3" fill="currentColor" />
      <circle cx="14" cy="-11" r="2.6" fill="var(--sector)" />
    </g>
  </SceneFrame>
);

const Justice: FC = () => (
  <SceneFrame>
    <path
      d="M150 22 v66 M120 92 h60"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    <path
      d="M150 30 L96 44 M150 30 L204 44"
      stroke="currentColor"
      strokeWidth="2"
    />
    <circle cx="150" cy="26" r="4" fill="var(--sector)" />
    <g
      fill="var(--sector)"
      fillOpacity=".16"
      stroke="var(--sector)"
      strokeWidth="2"
    >
      <path d="M78 44 l-14 30 h56 Z" />
      <path d="M222 44 l-14 30 h56 Z" />
    </g>
    <path d="M96 44 v-2 M204 44 v-2" stroke="var(--sector)" strokeWidth="2" />
    <g fill="currentColor" opacity=".45">
      <circle cx="150" cy="104" r="3" />
      <circle cx="162" cy="104" r="3" />
      <circle cx="138" cy="104" r="3" />
    </g>
  </SceneFrame>
);

const Agri: FC = () => (
  <SceneFrame>
    <g stroke="var(--sector)" strokeWidth="2" opacity=".55" fill="none">
      <path d="M0 100 q80 -14 300 -30" />
      <path d="M0 108 q80 -14 300 -30" opacity=".6" />
    </g>
    <g
      transform="translate(210 40)"
      stroke="var(--sector)"
      strokeWidth="2"
      fill="none"
    >
      <path d="M0 0 v40" strokeLinecap="round" />
      <g opacity=".9">
        <path d="M0 6 q-10 -4 -14 -12 M0 6 q10 -4 14 -12" />
        <path d="M0 18 q-10 -4 -14 -12 M0 18 q10 -4 14 -12" />
      </g>
    </g>
    <g transform="translate(46 44)">
      <rect
        x="10"
        y="8"
        width="34"
        height="22"
        rx="4"
        fill="currentColor"
        opacity=".82"
      />
      <rect
        x="30"
        y="-4"
        width="20"
        height="16"
        rx="3"
        fill="var(--sector)"
        opacity=".9"
      />
      <circle
        cx="18"
        cy="36"
        r="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />
      <circle
        cx="48"
        cy="38"
        r="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />
    </g>
    <g fill="var(--sector)">
      <circle cx="150" cy="34" r="3.4" opacity=".5" />
      <circle cx="166" cy="26" r="3.4" opacity=".75" />
      <circle cx="182" cy="20" r="3.4" />
    </g>
  </SceneFrame>
);

const Culture: FC = () => (
  <SceneFrame>
    <g transform="rotate(-8 150 58)">
      <rect
        x="70"
        y="40"
        width="160"
        height="40"
        rx="5"
        fill="currentColor"
        opacity=".85"
      />
      <g fill={PAPER}>
        <rect x="76" y="44" width="8" height="7" rx="1.5" />
        <rect x="76" y="69" width="8" height="7" rx="1.5" />
        <rect x="218" y="44" width="8" height="7" rx="1.5" />
        <rect x="218" y="69" width="8" height="7" rx="1.5" />
      </g>
      <g fill="var(--sector)" opacity=".85">
        <rect x="94" y="50" width="30" height="20" rx="2" />
        <rect x="132" y="50" width="30" height="20" rx="2" opacity=".6" />
        <rect x="170" y="50" width="30" height="20" rx="2" />
      </g>
    </g>
    <g transform="translate(250 40)">
      <circle
        r="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        opacity=".3"
      />
      <circle
        r="18"
        fill="none"
        stroke="var(--sector)"
        strokeWidth="7"
        strokeDasharray="70 113"
        strokeLinecap="round"
        transform="rotate(-90)"
      />
    </g>
  </SceneFrame>
);

// Tourism — a sun over sea waves with a sailboat: destination/coast, the МТ
// promotion mission (summer Black Sea + the marketing that sells it).
const Tourism: FC = () => (
  <SceneFrame>
    <path
      d="M0 78 q30 -11 60 0 t60 0 t60 0 t60 0 t60 0 V116 H0 Z"
      fill="var(--sector)"
      opacity=".18"
    />
    <path
      d="M0 90 q30 -11 60 0 t60 0 t60 0 t60 0 t60 0"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="2"
    />
    <circle cx="232" cy="40" r="15" fill="var(--sector)" opacity=".9" />
    <g
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      opacity=".8"
    >
      <path d="M232 15 v-7 M232 65 v7 M207 40 h-7 M257 40 h7 M214 22 l-5 -5 M250 22 l5 -5 M214 58 l-5 5 M250 58 l5 5" />
    </g>
    <g>
      <path d="M96 64 L96 28 L126 60 Z" fill="var(--sector)" opacity=".9" />
      <path d="M96 28 L96 72" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M72 72 L120 72 L110 84 L82 84 Z"
        fill={PAPER}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </g>
  </SceneFrame>
);

// Security / МВР (sector id "security") — a police badge (rounded shield + star)
// with a row of regional bars behind it (the 28 областни дирекции). Distinct from
// Defense's military shield + radar: a civil-order badge, not an armour scene.
const Security: FC = () => (
  <SceneFrame>
    {/* regional-unit bars behind the badge */}
    <g fill="var(--sector)" opacity=".16">
      <rect x="188" y="78" width="10" height="22" rx="1.5" />
      <rect x="204" y="66" width="10" height="34" rx="1.5" />
      <rect x="220" y="52" width="10" height="48" rx="1.5" />
      <rect x="236" y="70" width="10" height="30" rx="1.5" />
      <rect x="252" y="58" width="10" height="42" rx="1.5" />
    </g>
    {/* badge shield */}
    <path
      d="M84 18 l40 10 v30 c0 28 -22 40 -40 48 c-18 -8 -40 -20 -40 -48 V28 Z"
      fill="var(--sector)"
      opacity=".16"
      stroke="var(--sector)"
      strokeWidth="2"
    />
    {/* six-point star */}
    <g transform="translate(84 60)" fill="var(--sector)" opacity=".85">
      <path d="M0 -22 L6 -6 L22 0 L6 6 L0 22 L-6 6 L-22 0 L-6 -6 Z" />
      <circle r="4" fill={PAPER} />
    </g>
  </SceneFrame>
);

// Околна среда (МОСВ) — a leaf over mountains, with monitoring bars (the air/PM10
// series ИАОС measures). A leaf-green reads distinctly from teal-water and moss-defense.
const Environment: FC = () => (
  <SceneFrame>
    {/* mountains */}
    <g fill="var(--sector)" opacity=".16">
      <path d="M40 100 L90 44 L128 100 Z" />
      <path d="M104 100 L150 54 L196 100 Z" />
    </g>
    {/* monitoring bars (the measured outcome beside the money) */}
    <g fill="var(--sector)" opacity=".2">
      <rect x="214" y="80" width="9" height="20" rx="1.5" />
      <rect x="228" y="68" width="9" height="32" rx="1.5" />
      <rect x="242" y="74" width="9" height="26" rx="1.5" />
      <rect x="256" y="58" width="9" height="42" rx="1.5" />
    </g>
    {/* leaf */}
    <g transform="translate(150 34)">
      <path
        d="M0 0 C 34 4 40 34 8 52 C -24 34 -18 4 0 0 Z"
        fill="var(--sector)"
        opacity=".85"
      />
      <path
        d="M4 6 C 6 22 6 38 7 50"
        fill="none"
        stroke={PAPER}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M5 20 L18 16 M5 30 L17 28 M6 40 L15 39"
        fill="none"
        stroke={PAPER}
        strokeWidth="1.4"
        opacity=".8"
      />
    </g>
  </SceneFrame>
);

// Регионално развитие (МРРБ) — an oblast choropleth (region cells tinted at
// different depths, the per-oblast money map) with capital transfers arrowing
// down into the regions: the pass-through thesis (money МРРБ directs, doesn't
// itself procure) landing per oblast.
const Regional: FC = () => (
  <SceneFrame>
    {/* oblast choropleth cells — varied opacity = the per-oblast money depth */}
    <g fill="var(--sector)">
      <path d="M40 40 L96 34 L104 66 L52 74 Z" opacity=".5" />
      <path d="M96 34 L150 40 L154 70 L104 66 Z" opacity=".82" />
      <path d="M52 74 L104 66 L110 100 L58 102 Z" opacity=".28" />
      <path d="M104 66 L154 70 L152 100 L110 100 Z" opacity=".62" />
      <path d="M150 40 L196 48 L192 78 L154 70 Z" opacity=".38" />
    </g>
    {/* region borders */}
    <g
      fill="none"
      stroke={PAPER}
      strokeWidth="1.4"
      strokeLinejoin="round"
      opacity=".55"
    >
      <path d="M40 40 L96 34 L150 40 L196 48 L192 78 L152 100 L58 102 L52 74 Z" />
      <path d="M96 34 L104 66 L154 70 M52 74 L104 66 L110 100 M150 40 L154 70" />
    </g>
    {/* capital transfers arrowing down into the regions */}
    <g
      stroke="var(--sector)"
      strokeWidth="2.4"
      strokeLinecap="round"
      fill="none"
    >
      <path d="M232 30 V60" />
      <path d="M224 52 L232 62 L240 52" />
      <path d="M258 26 V52" opacity=".6" />
      <path d="M251 45 L258 54 L265 45" opacity=".6" />
    </g>
    {/* building — благоустройство / where the state invests */}
    <g transform="translate(224 66)">
      <rect
        x="0"
        y="6"
        width="20"
        height="30"
        rx="1.5"
        fill="var(--sector)"
        opacity=".9"
      />
      <rect
        x="26"
        y="0"
        width="24"
        height="36"
        rx="1.5"
        fill="var(--sector)"
        opacity=".7"
      />
      <g fill={PAPER}>
        <rect x="4" y="12" width="5" height="5" />
        <rect x="12" y="12" width="5" height="5" />
        <rect x="4" y="22" width="5" height="5" />
        <rect x="12" y="22" width="5" height="5" />
        <rect x="31" y="6" width="6" height="6" />
        <rect x="40" y="6" width="6" height="6" />
        <rect x="31" y="18" width="6" height="6" />
        <rect x="40" y="18" width="6" height="6" />
      </g>
    </g>
  </SceneFrame>
);

export const SECTOR_SCENES: Record<string, FC> = {
  roads: Roads,
  water: Water,
  transport: Transport,
  energy: Energy,
  environment: Environment,
  regional: Regional,
  pension: Pension,
  social: Social,
  health: Health,
  edu: Edu,
  schools: Schools,
  revenue: Revenue,
  customs: Customs,
  administration: Administration,
  defense: Defense,
  security: Security,
  justice: Justice,
  agri: Agri,
  culture: Culture,
  tourism: Tourism,
};
