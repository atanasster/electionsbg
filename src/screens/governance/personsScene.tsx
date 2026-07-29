// Хора — the vignette for the /persons tile, shared by the /governance hub and the
// /governance/declarations sub-hub.
//
// It lives in its OWN module rather than in either hub's scene registry so both can import
// the COMPONENT. Reaching through a sibling's `Record<string, FC>` lookup instead would be
// an unchecked index read (`noUncheckedIndexedAccess` is off), and a renamed key would type
// as `FC` while being `undefined` at runtime — which `InfographicTile` renders unguarded,
// so it white-screens the route rather than dropping the picture. It also stops the
// declarations chunk pulling in all ~19 governance scenes to draw one tile.
//
// Drawing contract: src/ux/infographic/README.md (300×116 SceneFrame, ink via currentColor,
// accent via var(--sector), PAPER for under-ink fills). Neither host passes a `metric`, so
// the stat-overlay reserve does not apply and the grid composes around the frame centre
// like its neighbours. Every card carries the SAME silhouette — no face is implied.

import { FC } from "react";
import { SceneFrame, PAPER } from "@/ux/infographic";

// Four columns × two rows. The highlighted card is second from the left on the top row.
const CARDS: { x: number; y: number; on: boolean }[] = [];
for (let r = 0; r < 2; r++)
  for (let c = 0; c < 4; c++)
    CARDS.push({ x: 90 + c * 40, y: 12 + r * 52, on: r === 0 && c === 1 });

export const PersonsScene: FC = () => (
  <SceneFrame>
    {CARDS.map((card) => (
      <g key={`${card.x}-${card.y}`}>
        <rect
          x={card.x}
          y={card.y}
          width={32}
          height={44}
          rx={4}
          fill={card.on ? "var(--sector)" : PAPER}
          stroke="currentColor"
          strokeWidth={card.on ? 0 : 1.5}
          opacity={card.on ? 0.9 : 0.55}
        />
        <circle
          cx={card.x + 16}
          cy={card.y + 15}
          r={6}
          fill={card.on ? PAPER : "currentColor"}
          opacity={card.on ? 0.95 : 0.5}
        />
        <path
          d={`M${card.x + 5} ${card.y + 36} a11 11 0 0 1 22 0 z`}
          fill={card.on ? PAPER : "currentColor"}
          opacity={card.on ? 0.95 : 0.5}
        />
      </g>
    ))}
    {/* A magnifier at the left, tying the grid to the act of searching it. */}
    <circle
      cx={44}
      cy={30}
      r={13}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      opacity={0.55}
    />
    <path
      d="M53 40 L68 55"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      opacity={0.55}
    />
  </SceneFrame>
);
