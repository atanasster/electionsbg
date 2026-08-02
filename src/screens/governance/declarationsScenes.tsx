// Infographic vignettes for the /governance/declarations sub-hub tiles. Same
// SceneFrame contract as sectorScenes.tsx (300×116, currentColor ink,
// var(--sector) accent, PAPER for under-ink fills). Decorative; the tile title
// labels each.

/* eslint-disable react-refresh/only-export-components -- DECLARATION_SCENES is a
   lookup table of scene components, not a fast-refresh boundary. */
import { FC } from "react";
import { PersonsScene } from "./personsScene";
import { ConnectionsScene } from "./connectionsScene";
import { SceneFrame, PAPER } from "@/ux/infographic";

// Имущество на депутати — a house over a coin.
const Assets: FC = () => (
  <SceneFrame>
    <path
      d="M150 26 L206 62 H190 V100 H110 V62 H94 Z"
      fill="var(--sector)"
      opacity=".85"
    />
    <rect x={134} y={74} width={32} height={26} rx={2} fill={PAPER} />
    <circle
      cx={150}
      cy={58}
      r={12}
      fill="none"
      stroke={PAPER}
      strokeWidth="2"
    />
  </SceneFrame>
);

// Автомобили — a simple car silhouette.
const Cars: FC = () => (
  <SceneFrame>
    <path
      d="M78 78 L96 52 H204 L222 78 V92 H78 Z"
      fill="var(--sector)"
      opacity=".85"
    />
    <path d="M112 52 L120 68 H180 L188 52" fill={PAPER} opacity=".9" />
    <g fill="currentColor">
      <circle cx={108} cy={92} r={12} />
      <circle cx={192} cy={92} r={12} />
    </g>
  </SceneFrame>
);

// Дружества — a cluster of company buildings.
const Companies: FC = () => (
  <SceneFrame>
    <g fill="var(--sector)">
      <rect x={104} y={44} width={28} height={60} rx={3} opacity=".6" />
      <rect x={138} y={28} width={30} height={76} rx={3} opacity=".9" />
      <rect x={174} y={54} width={26} height={50} rx={3} opacity=".7" />
    </g>
    <g fill={PAPER} opacity=".9">
      <rect x={146} y={38} width={6} height={6} />
      <rect x={158} y={38} width={6} height={6} />
      <rect x={146} y={52} width={6} height={6} />
      <rect x={158} y={52} width={6} height={6} />
    </g>
  </SceneFrame>
);

// Длъжностни лица — a person with an office badge.
const Officials: FC = () => (
  <SceneFrame>
    <circle cx={150} cy={44} r={18} fill="var(--sector)" opacity=".9" />
    <path d="M112 104 a38 34 0 0 1 76 0 Z" fill="var(--sector)" opacity=".7" />
    <rect x={140} y={74} width={20} height={26} rx={2} fill={PAPER} />
    <path d="M150 76 l6 6 -6 6 -6 -6 Z" fill="var(--sector)" opacity=".9" />
  </SceneFrame>
);

export const DECLARATION_SCENES: Record<string, FC> = {
  // The same vignette the /governance hub uses — one destination, one picture, imported
  // as a COMPONENT rather than read out of that hub's lookup table (see personsScene.tsx).
  persons: PersonsScene,
  connections: ConnectionsScene,
  assets: Assets,
  cars: Cars,
  companies: Companies,
  officials: Officials,
};
