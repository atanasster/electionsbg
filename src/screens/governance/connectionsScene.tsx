// Връзки — the vignette for the /connections tile, shared by the /governance hub and the
// /governance/declarations sub-hub.
//
// Same reasoning as personsScene.tsx, and the same reason it lives in its own module: both
// hubs import the COMPONENT rather than reaching through a sibling's `Record<string, FC>`,
// which would be an unchecked index read that types as `FC` while being `undefined` at
// runtime — and `InfographicTile` renders `<Scene />` unguarded, so that white-screens the
// route instead of dropping the picture.
//
// It was briefly drawn TWICE — a hub-and-five-satellites version on /governance beside this
// hub-and-three-companies one on /governance/declarations. One destination, one picture.
//
// Drawing contract: src/ux/infographic/README.md (300×116 SceneFrame, ink via currentColor,
// accent via var(--sector)). Neither host passes a `metric`, so the stat-overlay reserve
// does not apply.

import { FC } from "react";
import { SceneFrame } from "@/ux/infographic";

// A person node linked to two companies above and one below.
export const ConnectionsScene: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth="2" opacity=".55">
      <path d="M150 58 L98 32 M150 58 L202 32 M150 58 L150 96" />
    </g>
    <circle cx={150} cy={58} r={13} fill="var(--sector)" />
    <g fill="var(--sector)" opacity=".85">
      <rect x={86} y={22} width={24} height={20} rx={3} />
      <rect x={190} y={22} width={24} height={20} rx={3} />
      <rect x={136} y={88} width={28} height={20} rx={3} />
    </g>
  </SceneFrame>
);
