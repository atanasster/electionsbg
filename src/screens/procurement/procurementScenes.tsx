// Infographic scenes for the /procurement hub sub-page tiles. Same SceneFrame
// contract as the sector scenes (see src/ux/infographic/README.md): ink via
// currentColor, accent via var(--sector), PAPER for under-ink fills; decorative
// (aria-hidden via the frame). The "analysis" scene reuses the shared Bars +
// TrendLine primitives to show how new scenes compose rather than re-draw.

/* eslint-disable react-refresh/only-export-components -- PROCUREMENT_SCENES is a
   lookup table of scene components, not a fast-refresh boundary. */
import { FC } from "react";
import { SceneFrame, PAPER, Bars, TrendLine } from "@/ux/infographic";

const Analysis: FC = () => (
  <SceneFrame>
    <rect
      x="34"
      y="22"
      width="110"
      height="22"
      rx="4"
      fill="var(--sector)"
      opacity=".85"
    />
    <rect
      x="34"
      y="52"
      width="150"
      height="7"
      rx="3"
      fill="currentColor"
      opacity=".35"
    />
    <rect
      x="34"
      y="64"
      width="120"
      height="7"
      rx="3"
      fill="currentColor"
      opacity=".28"
    />
    <Bars
      x={40}
      baseline={104}
      heights={[18, 30, 44, 34]}
      barWidth={13}
      gap={8}
    />
    <TrendLine
      points={[
        [188, 86],
        [214, 70],
        [238, 78],
        [268, 42],
      ]}
      arrow
    />
  </SceneFrame>
);

const Contracts: FC = () => (
  <SceneFrame>
    <rect
      x="118"
      y="26"
      width="86"
      height="66"
      rx="6"
      fill="currentColor"
      opacity=".16"
    />
    <path
      d="M96 32 h66 l18 18 v50 h-84 Z"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <path
      d="M162 32 v18 h18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <g stroke="var(--sector)" strokeWidth="3" strokeLinecap="round">
      <path d="M108 62 h52 M108 74 h52 M108 86 h30" />
    </g>
  </SceneFrame>
);

const Tenders: FC = () => (
  <SceneFrame>
    <rect
      x="110"
      y="22"
      width="80"
      height="74"
      rx="6"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <rect x="134" y="15" width="32" height="13" rx="3" fill="var(--sector)" />
    <path
      d="M126 54 l10 10 l22 -22"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M126 80 h48"
      stroke="currentColor"
      strokeWidth="2.4"
      opacity=".4"
    />
  </SceneFrame>
);

const Appeals: FC = () => (
  <SceneFrame>
    <path
      d="M150 22 v62 M124 88 h52"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    <path
      d="M150 30 L110 44 M150 30 L190 44"
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
      <path d="M110 44 l-13 28 h52 Z" />
      <path d="M190 44 l-13 28 h52 Z" />
    </g>
  </SceneFrame>
);

const Ngos: FC = () => (
  <SceneFrame>
    <path
      d="M150 44 c-9 -17 -34 -14 -34 7 c0 17 21 30 34 41 c13 -11 34 -24 34 -41 c0 -21 -25 -24 -34 -7 Z"
      fill="var(--sector)"
      opacity=".85"
    />
    <path
      d="M126 52 h10 l5 -8 l7 16 l5 -8 h12"
      fill="none"
      stroke={PAPER}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </SceneFrame>
);

const Place: FC = () => (
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
    <circle cx="150" cy="46" r="8" fill={PAPER} />
  </SceneFrame>
);

const Risk: FC = () => (
  <SceneFrame>
    <rect
      x="112"
      y="22"
      width="5"
      height="70"
      rx="2"
      fill="currentColor"
      opacity=".55"
    />
    <path d="M117 24 h46 l-10 13 l10 13 h-46 Z" fill="var(--sector)" />
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M188 86 l18 -32 l18 32 Z" />
    </g>
    <rect x="205" y="62" width="2" height="12" rx="1" fill="currentColor" />
    <circle cx="206" cy="80" r="1.6" fill="currentColor" />
  </SceneFrame>
);

const Watch: FC = () => (
  <SceneFrame>
    <path
      d="M150 24 l9 18.2 l20.1 2.9 l-14.5 14.2 l3.4 20 L150 92 l-18 9.5 l3.4 -20 l-14.5 -14.2 l20.1 -2.9 Z"
      fill="var(--sector)"
      opacity=".85"
    />
  </SceneFrame>
);

export const PROCUREMENT_SCENES: Record<string, FC> = {
  analysis: Analysis,
  contracts: Contracts,
  tenders: Tenders,
  appeals: Appeals,
  ngos: Ngos,
  place: Place,
  risk: Risk,
  watch: Watch,
};
