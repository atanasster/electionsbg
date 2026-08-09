// Infographic vignettes for the /funds hub tiles — the same drawing contract as
// parliamentScenes.tsx / governanceScenes.tsx (300×116 SceneFrame, ink = currentColor,
// accent = var(--sector), PAPER for under-ink fills; see src/ux/infographic/README.md).
//
// One bespoke scene per tile, none reused from another hub. The rule that makes these worth
// drawing at all: a scene shows the STRUCTURE its destination is about — the map's silhouette,
// the flow's split, the two overlapping corpora — not a generic bar chart with a different
// accent. A reader should be able to tell two tiles apart with the labels covered.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// DENSE MARKS STAY OUT OF THE BOTTOM-LEFT. `InfographicTile` overlays a `metric` large at the
// banner's bottom-left, behind a radial scrim (`72% 72% at 6% 100%`) — so anything drawn there
// is either hidden by the number or fighting it. The tile's own source calls the glow „a safety
// net, not a licence to draw behind the number".
//
// The first cut of this file broke that in EIGHT of ten scenes — `absorption` put a solid
// 180×42 accent block exactly where the figure goes. Invisible today only because step 7 has
// not wired the metrics yet, and certain to bite the moment it does, since migration 145 has a
// measured figure for every one of these tiles.
//
// SAFE BOX, enforced by `fundsScenes.test.tsx`: no `var(--sector)`-filled mark may overlap
// x < 132 AND y > 72. Strokes and PAPER fills may — they sit under the scrim quietly.
// ═══════════════════════════════════════════════════════════════════════════════════════════

/* eslint-disable react-refresh/only-export-components -- FUNDS_SCENES is a lookup table of
   scene components, not a fast-refresh boundary. */
import { type FC, useId } from "react";
import { SceneFrame, PAPER } from "@/ux/infographic";

// Бенефициенти — a ranked column of organisation rows, the longest bar first. The mark is the
// RANKING itself, because that is what the page is: who received the most.
const Beneficiaries: FC = () => (
  <SceneFrame>
    {[
      { y: 18, w: 116 },
      { y: 34, w: 94 },
      { y: 50, w: 76 },
      { y: 66, w: 54 },
    ].map((r) => (
      <g key={r.y}>
        <circle
          cx="146"
          cy={r.y}
          r="6"
          fill={PAPER}
          stroke="currentColor"
          strokeWidth="1.5"
          opacity=".55"
        />
        <rect
          x="158"
          y={r.y - 5}
          width={r.w}
          height="10"
          rx="3"
          fill="var(--sector)"
          opacity=".75"
        />
      </g>
    ))}
  </SceneFrame>
);

// Програми — nested brackets: a programme contains procedures, a procedure contains contracts.
// The tile fronts the picker, so the mark is the HIERARCHY you are picking a level of.
const Programmes: FC = () => (
  <SceneFrame>
    {[0, 1, 2].map((i) => (
      <rect
        key={i}
        x={138 + i * 16}
        y={12 + i * 12}
        width={144 - i * 32}
        height={62 - i * 24}
        rx="6"
        fill={i === 2 ? "var(--sector)" : PAPER}
        opacity={i === 2 ? 0.8 : 0.35}
        stroke="currentColor"
        strokeWidth="1.5"
      />
    ))}
  </SceneFrame>
);

// По място — a coarse Bulgaria silhouette with a filled half. THE mark for this page: the map
// carries only about half the money, and the vignette says so before the caption does.
const Places: FC = () => {
  // `useId`, not a literal: a hard-coded clipPath id collides the moment the same scene renders
  // twice on one page, and the second instance silently inherits the first's clip.
  const clip = useId();
  return (
    <SceneFrame>
      <defs>
        {/* EAST half. The accent used to clip to x < 150, i.e. straight through the metric. */}
        <clipPath id={clip}>
          <rect x="150" y="0" width="150" height="116" />
        </clipPath>
      </defs>
      <path
        d="M44 36l30-12 34 6 28-10 40 4 34 14-6 26-24 18-38 6-30-8-32 4-28-14z"
        fill={PAPER}
        stroke="currentColor"
        strokeWidth="1.8"
        opacity=".6"
      />
      <path
        d="M44 36l30-12 34 6 28-10 40 4 34 14-6 26-24 18-38 6-30-8-32 4-28-14z"
        fill="var(--sector)"
        opacity=".75"
        clipPath={`url(#${clip})`}
      />
    </SceneFrame>
  );
};

// Свързани лица — a bipartite link: politicians on the left, companies on the right, edges
// between. Drawn as a GRAPH rather than a warning sign, because the page publishes a signal to
// check and not a verdict.
const Political: FC = () => (
  <SceneFrame>
    <g stroke="currentColor" strokeWidth="1.4" opacity=".45">
      <path d="M150 22L232 18M150 22L232 50M150 50L232 50M150 50L232 82M150 78L232 82" />
    </g>
    {[22, 50, 78].map((y) => (
      <circle
        key={y}
        cx="150"
        cy={y}
        r="8"
        fill="var(--sector)"
        opacity=".85"
      />
    ))}
    {[18, 50, 82].map((y) => (
      <rect
        key={y}
        x="226"
        y={y - 7}
        width="16"
        height="16"
        rx="3"
        fill={PAPER}
        stroke="currentColor"
        strokeWidth="1.6"
        opacity=".7"
      />
    ))}
  </SceneFrame>
);

// Интегритет — a concentration curve: one programme's share taken by its largest winner. The
// mark is the SHAPE of concentration, a steep head and a long tail.
const Integrity: FC = () => (
  <SceneFrame>
    <path
      d="M28 96C70 96 84 34 120 30S196 74 246 76"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="3"
      opacity=".85"
      strokeLinecap="round"
    />
    <g stroke="currentColor" strokeWidth="1.2" opacity=".3">
      <path d="M140 70h132M140 70V16" />
    </g>
    {[190, 224, 254].map((x, i) => (
      <circle key={x} cx={x} cy={[20, 38, 50][i]} r="4" fill="var(--sector)" />
    ))}
  </SceneFrame>
);

// Договори и грантове — two overlapping sets, the intersection filled. Literally the page:
// firms present in BOTH corpora.
const DualCorpus: FC = () => {
  const clip = useId();
  return (
    <SceneFrame>
      <defs>
        <clipPath id={clip}>
          <circle cx="222" cy="42" r="34" />
        </clipPath>
      </defs>
      <circle
        cx="180"
        cy="42"
        r="34"
        fill={PAPER}
        stroke="currentColor"
        strokeWidth="1.8"
        opacity=".65"
      />
      <circle
        cx="222"
        cy="42"
        r="34"
        fill={PAPER}
        stroke="currentColor"
        strokeWidth="1.8"
        opacity=".65"
      />
      <circle
        cx="180"
        cy="42"
        r="34"
        fill="var(--sector)"
        opacity=".8"
        clipPath={`url(#${clip})`}
      />
    </SceneFrame>
  );
};

// Фокус — a magnifier over a stack of records. The dossiers are an editorial LENS on the same
// corpus, which is what the glass says and a folder icon would not.
const Focus: FC = () => (
  <SceneFrame>
    <g opacity=".45" stroke="currentColor" strokeWidth="1.6" fill={PAPER}>
      <rect x="132" y="16" width="96" height="14" rx="3" />
      <rect x="132" y="36" width="96" height="14" rx="3" />
      <rect x="132" y="56" width="96" height="14" rx="3" />
    </g>
    <circle
      cx="176"
      cy="50"
      r="30"
      fill={PAPER}
      fillOpacity=".9"
      stroke="var(--sector)"
      strokeWidth="4"
    />
    <path
      d="M198 72l22 22"
      stroke="var(--sector)"
      strokeWidth="6"
      strokeLinecap="round"
    />
  </SceneFrame>
);

// Усвояване — a partly filled vessel. Contracted is the outline, paid is the fill: the one
// mark on this hub where the empty part carries as much meaning as the full part.
const Absorption: FC = () => (
  <SceneFrame>
    <rect
      x="140"
      y="14"
      width="132"
      height="56"
      rx="8"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="2"
      opacity=".6"
    />
    <rect
      x="140"
      y="40"
      width="132"
      height="30"
      rx="8"
      fill="var(--sector)"
      opacity=".8"
    />
    <path
      d="M140 40h132"
      stroke="currentColor"
      strokeWidth="2"
      opacity=".5"
      strokeDasharray="5 4"
    />
  </SceneFrame>
);

// ПВУ — milestone steps with the later ones unfilled. The Recovery Plan is the newest
// instrument and its absorption is lowest; the mark is a schedule part-way through.
const Rrf: FC = () => (
  <SceneFrame>
    {[0, 1, 2, 3].map((i) => (
      <rect
        key={i}
        x={140 + i * 34}
        y={66 - i * 14}
        width="26"
        height={i * 14 + 10}
        rx="4"
        fill={i < 2 ? "var(--sector)" : PAPER}
        opacity={i < 2 ? 0.8 : 0.4}
        stroke="currentColor"
        strokeWidth="1.5"
      />
    ))}
  </SceneFrame>
);

// Interreg — a border with paired nodes either side. The corpus ИСУН does not hold, and the
// reason it matters: every euro of it lands on a border.
const Interreg: FC = () => (
  <SceneFrame>
    <path
      d="M204 8v62"
      stroke="currentColor"
      strokeWidth="2"
      opacity=".45"
      strokeDasharray="7 6"
    />
    {[
      [166, 18],
      [156, 40],
      [174, 62],
    ].map(([x, y]) => (
      <g key={`l${x}-${y}`}>
        <circle cx={x} cy={y} r="8" fill="var(--sector)" opacity=".85" />
        <path
          d={`M${x + 8} ${y}H${300 - x - 8}`}
          stroke="currentColor"
          strokeWidth="1.3"
          opacity=".4"
        />
        <circle
          cx={300 - x}
          cy={y}
          r="8"
          fill={PAPER}
          stroke="currentColor"
          strokeWidth="1.6"
          opacity=".7"
        />
      </g>
    ))}
  </SceneFrame>
);

/** id → scene. EVERY tile id in fundsRegistry.ts must have an entry: `InfographicTile` renders
 *  `<Scene />` unguarded, so a missing one is `undefined` as a component type — "Element type is
 *  invalid" and a white screen, not a blank vignette. Gated in fundsHubRegistry.test.ts. */
export const FUNDS_SCENES: Record<string, FC> = {
  beneficiaries: Beneficiaries,
  programmes: Programmes,
  places: Places,
  political: Political,
  integrity: Integrity,
  dualCorpus: DualCorpus,
  focus: Focus,
  absorption: Absorption,
  rrf: Rrf,
  interreg: Interreg,
};
