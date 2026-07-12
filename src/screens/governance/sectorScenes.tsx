// Bespoke per-sector infographic vignettes for the /governance/sectors hub —
// deliberately NOT icons. Each is a small "scene" (a highway + km bars, a pulse
// line into a hospital cross, rising coin stacks, a container ship…) that hints
// at what the sector's dashboard actually measures.
//
// Theme-aware with zero props: structural ink is drawn with `currentColor`, so
// it inherits the tile's text colour (a muted foreground that flips with the
// theme); the sector's accent pop is `var(--sector)`, which each tile sets from
// its hex in SectorHub. Paper fills (receipt body, film frames) use
// `hsl(var(--card))` so they read on both the cream and the navy ground.

import { FC } from "react";

const VB = "0 0 300 116";
// The banner sits on a per-sector-tinted gradient; the ink needs to hold on
// both grounds, so we lean on the theme foreground rather than a fixed grey.
const cls = "block h-auto w-full text-foreground/70";
const paper = "hsl(var(--card))";

const Roads: FC = () => (
  <svg viewBox={VB} className={cls} role="img" aria-label="Пътища">
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
  </svg>
);

const Water: FC = () => (
  <svg viewBox={VB} className={cls} role="img" aria-label="Води">
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
      stroke={paper}
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
  </svg>
);

const Transport: FC = () => (
  <svg viewBox={VB} className={cls} role="img" aria-label="Транспорт">
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
      <rect x="8" y="14" width="14" height="12" rx="2" fill={paper} />
      <rect x="30" y="14" width="16" height="12" rx="2" fill={paper} />
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
  </svg>
);

const Pension: FC = () => (
  <svg viewBox={VB} className={cls} role="img" aria-label="Пенсии">
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
  </svg>
);

const Social: FC = () => (
  <svg viewBox={VB} className={cls} role="img" aria-label="Осигуряване">
    {/* umbrella = safety net */}
    <path d="M78 40 a52 52 0 0 1 104 0 Z" fill="var(--sector)" opacity=".85" />
    <path d="M78 40 h104" stroke={paper} strokeWidth="2" />
    <path
      d="M130 40 v44 a10 10 0 0 0 20 0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    {/* three sheltered figures */}
    <g fill="currentColor" opacity=".7">
      <circle cx="96" cy="86" r="6" />
      <path d="M86 104 a10 10 0 0 1 20 0 Z" />
      <circle cx="180" cy="86" r="6" />
      <path d="M170 104 a10 10 0 0 1 20 0 Z" />
    </g>
    {/* contribution bars */}
    <g fill="var(--sector)">
      <rect x="214" y="84" width="10" height="20" rx="2" opacity=".5" />
      <rect x="228" y="74" width="10" height="30" rx="2" opacity=".72" />
      <rect x="242" y="64" width="10" height="40" rx="2" />
    </g>
  </svg>
);

const Health: FC = () => (
  <svg viewBox={VB} className={cls} role="img" aria-label="Здравна каса">
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
    <g fill={paper}>
      <rect x="188" y="44" width="12" height="40" rx="3" />
      <rect x="174" y="58" width="40" height="12" rx="3" />
    </g>
    <g fill="currentColor" opacity=".5">
      <rect x="240" y="72" width="8" height="22" rx="2" />
      <rect x="252" y="60" width="8" height="34" rx="2" />
      <rect x="264" y="66" width="8" height="28" rx="2" />
    </g>
  </svg>
);

const Edu: FC = () => (
  <svg viewBox={VB} className={cls} role="img" aria-label="Образование">
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
  </svg>
);

const Schools: FC = () => (
  <svg viewBox={VB} className={cls} role="img" aria-label="Училища и матури">
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
        fill={paper}
        fontSize="26"
        fontWeight="700"
        fontFamily="Georgia, serif"
      >
        6
      </text>
    </g>
  </svg>
);

const Revenue: FC = () => (
  <svg viewBox={VB} className={cls} role="img" aria-label="Приходи (НАП)">
    <path
      d="M40 20 h74 v72 l-9 -6 -9 6 -9 -6 -9 6 -9 -6 -9 6 -9 -6 -12 6 Z"
      fill={paper}
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
      fill={paper}
      fontSize="20"
      fontWeight="700"
      fontFamily="Georgia, serif"
    >
      %
    </text>
  </svg>
);

const Customs: FC = () => (
  <svg viewBox={VB} className={cls} role="img" aria-label="Митници">
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
  </svg>
);

const Administration: FC = () => (
  <svg viewBox={VB} className={cls} role="img" aria-label="Администрация">
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
      stroke={paper}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Defense: FC = () => (
  <svg viewBox={VB} className={cls} role="img" aria-label="Отбрана">
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
  </svg>
);

const Justice: FC = () => (
  <svg viewBox={VB} className={cls} role="img" aria-label="Съдебна власт">
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
  </svg>
);

const Agri: FC = () => (
  <svg viewBox={VB} className={cls} role="img" aria-label="Земеделие">
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
  </svg>
);

const Culture: FC = () => (
  <svg viewBox={VB} className={cls} role="img" aria-label="Култура">
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
      <g fill={paper}>
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
  </svg>
);

export const SECTOR_SCENES: Record<string, FC> = {
  roads: Roads,
  water: Water,
  transport: Transport,
  pension: Pension,
  social: Social,
  health: Health,
  edu: Edu,
  schools: Schools,
  revenue: Revenue,
  customs: Customs,
  administration: Administration,
  defense: Defense,
  justice: Justice,
  agri: Agri,
  culture: Culture,
};
