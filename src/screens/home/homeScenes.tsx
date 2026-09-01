/* eslint-disable react-refresh/only-export-components -- HOME_SCENES is a lookup table of
   module-local scene components, not a component export: nothing outside this file renders
   one directly, so Fast Refresh has no boundary to preserve. Every sibling *Scenes.tsx
   carries the same header. */

// One bespoke 300×116 scene per home tile.
//
// The contract is `SceneFrame`'s: structural ink is `currentColor` (so it flips with the
// theme for free — never a hardcoded grey), and the accent pop is `var(--sector)`, which the
// host tile sets from the registry's `TILE_ACCENTS` token. Every scene is `aria-hidden` via
// the frame, so nothing here carries meaning the tile's text does not also carry.
//
// ⚠️ EIGHT DISTINCT SCENES, one per tile. A shared or repeated scene makes two destinations
// look like the same kind of thing at a glance, which is the whole reason the grid uses
// drawings rather than icons. `homeHubBands.test.ts` asserts the set is complete and that no
// two tiles share one.

import { FC } from "react";
import { Bars, Donut, SceneFrame, TrendLine, PAPER } from "@/ux/infographic";

/** Prices — a receipt with a rising price line beside it. */
const PricesScene: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth="2" fill={PAPER}>
      <path d="M28 20 h64 v70 l-8 -6 -8 6 -8 -6 -8 6 -8 -6 -8 6 -8 -6 v-64 z" />
    </g>
    <g
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.55"
    >
      <path d="M40 36 h40 M40 48 h40 M40 60 h26" />
    </g>
    <TrendLine
      points={[
        [126, 84],
        [156, 70],
        [186, 74],
        [216, 46],
        [252, 28],
      ]}
      arrow
    />
  </SceneFrame>
);

/** My area — a map pin over a settlement outline. */
const MyAreaScene: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth="2" fill="none" opacity="0.5">
      <path d="M24 88 l34 -22 l30 14 l34 -26 l32 18 l40 -26 l40 22" />
    </g>
    <g fill="var(--sector)">
      <path d="M150 20 c-13 0 -23 10 -23 23 c0 17 23 41 23 41 s23 -24 23 -41 c0 -13 -10 -23 -23 -23 z" />
    </g>
    <circle cx="150" cy="43" r="8" fill={PAPER} />
  </SceneFrame>
);

/** Elections — a ballot going into a box. */
const ElectionsScene: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth="2" fill={PAPER}>
      <rect x="96" y="54" width="108" height="42" rx="3" />
      <path d="M120 54 h60 v-40 h-60 z" />
    </g>
    <rect x="132" y="50" width="36" height="8" rx="2" fill="var(--sector)" />
    <g
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.6"
    >
      <path d="M132 26 h36 M132 36 h24" />
    </g>
  </SceneFrame>
);

/** Sectors — a grid of blocks at different weights. */
const SectorsScene: FC = () => (
  <SceneFrame>
    {[0, 1, 2, 3].map((col) =>
      [0, 1].map((row) => (
        <rect
          key={`${col}-${row}`}
          x={64 + col * 44}
          y={26 + row * 40}
          width="34"
          height="30"
          rx="3"
          fill="var(--sector)"
          opacity={0.28 + ((col + row * 2) % 4) * 0.2}
        />
      )),
    )}
  </SceneFrame>
);

/** Budget — stacked allocation bars under a baseline. */
const BudgetScene: FC = () => (
  <SceneFrame>
    <Bars
      x={58}
      baseline={92}
      heights={[26, 44, 34, 58, 40, 68]}
      barWidth={22}
      gap={12}
    />
    <g stroke="currentColor" strokeWidth="2" opacity="0.6">
      <path d="M46 92 h212" />
    </g>
  </SceneFrame>
);

/** Procurement — a signed contract sheet. */
const ProcurementScene: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth="2" fill={PAPER}>
      <path d="M104 14 h74 l18 18 v70 h-92 z" />
      <path d="M178 14 v18 h18" />
    </g>
    <g
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.55"
    >
      <path d="M118 44 h56 M118 56 h56 M118 68 h34" />
    </g>
    <path
      d="M116 88 c10 -10 18 6 28 -2 c8 -6 14 4 24 -4"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </SceneFrame>
);

/** EU funds — a ring of stars around a share dial. */
const FundsScene: FC = () => (
  <SceneFrame>
    <Donut cx={150} cy={58} pct={62} r={26} thickness={9} />
    {Array.from({ length: 10 }).map((_, i) => {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      return (
        <circle
          key={i}
          cx={150 + Math.cos(a) * 44}
          cy={58 + Math.sin(a) * 44}
          r="3"
          fill="var(--sector)"
          opacity="0.75"
        />
      );
    })}
  </SceneFrame>
);

/** Governance — connected figures: people linked to institutions. */
const GovernanceScene: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth="2" opacity="0.5">
      <path d="M92 44 L150 74 L208 44 M150 74 v18" />
    </g>
    {[
      [92, 44],
      [208, 44],
      [150, 30],
    ].map(([cx, cy], i) => (
      <circle
        key={i}
        cx={cx}
        cy={cy}
        r="11"
        fill="var(--sector)"
        opacity="0.85"
      />
    ))}
    <circle
      cx={150}
      cy={74}
      r="9"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="2"
    />
    <rect
      x="132"
      y="92"
      width="36"
      height="12"
      rx="2"
      fill="var(--sector)"
      opacity="0.5"
    />
  </SceneFrame>
);

/** id → scene. EVERY tile id in `homeRegistry.ts` must have an entry: `InfographicTile`
 *  renders `<Scene />` unguarded, so a missing one is `undefined` as a component type —
 *  "Element type is invalid" and a white screen, not a blank vignette.
 *
 *  ⚠️ THERE IS NO COMPILE-TIME CHECK. This is `Record<string, FC>` and
 *  `noUncheckedIndexedAccess` is off, so `HOME_SCENES[id]` types as `FC` whether or not the
 *  key exists. `homeHubBands.test.ts` is the gate — do not delete it as redundant. */
export const HOME_SCENES: Record<string, FC> = {
  prices: PricesScene,
  "my-area": MyAreaScene,
  elections: ElectionsScene,
  sectors: SectorsScene,
  budget: BudgetScene,
  procurement: ProcurementScene,
  funds: FundsScene,
  governance: GovernanceScene,
};
