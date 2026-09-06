// Infographic scenes for the `/elections` hub tiles.
//
// Same SceneFrame contract as the sector / analysis / home scenes (see
// src/ux/infographic/README.md): 300×116, structural ink via `currentColor`, the accent via
// `var(--sector)`, PAPER for under-ink fills; decorative, aria-hidden via the frame.
//
// ⚠ THESE TILES CARRY NO STAT OVERLAY, so unlike the analysis scenes they may use the whole
// frame. The hub's figures live in the head's KPI band (§3.1 rule 5 — a figure is the band's OR
// the tile's, never both), and this hub puts them all in the band.
//
// ⚠ A MISSING SCENE IS A WHITE SCREEN, not a blank tile: `InfographicTile` renders `<Scene />`
// unguarded, so an id with no entry here is `undefined` as a component type — "Element type is
// invalid". `electionsHubBands.test.ts` fails on it.

/* eslint-disable react-refresh/only-export-components -- ELECTIONS_SCENES is a lookup table of
   scene components, not a fast-refresh boundary. */
import { FC } from "react";
import { SceneFrame, PAPER, Bars, TrendLine, Donut } from "@/ux/infographic";

/** A ballot paper with ticked lines — the shape most of this hub is about. */
const Ballot: FC = () => (
  <SceneFrame>
    <rect
      x="96"
      y="14"
      width="108"
      height="88"
      rx="4"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="2"
    />
    {[32, 50, 68, 86].map((y, i) => (
      <g key={y}>
        <rect
          x="108"
          y={y - 8}
          width="14"
          height="14"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <rect
          x="130"
          y={y - 6}
          width={62 - i * 8}
          height="6"
          rx="3"
          fill="var(--sector)"
          opacity={i === 1 ? 1 : 0.35}
        />
      </g>
    ))}
    <path
      d="M110 44 l4 5 l8 -10"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </SceneFrame>
);

/** A parliament hemicycle. */
const Hemicycle: FC = () => (
  <SceneFrame>
    <path
      d="M60 96 A90 90 0 0 1 240 96"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      opacity=".5"
    />
    {[0, 1, 2].map((ring) => {
      const r = 78 - ring * 22;
      return (
        <path
          key={ring}
          d={`M${150 - r} 96 A${r} ${r} 0 0 1 ${150 + r} 96`}
          fill="none"
          stroke="var(--sector)"
          strokeWidth="8"
          strokeDasharray="12 7"
          opacity={0.9 - ring * 0.25}
        />
      );
    })}
    <rect x="146" y="88" width="8" height="8" fill="currentColor" />
  </SceneFrame>
);

/** A mayor's chain of office over a town silhouette. */
const Mayor: FC = () => (
  <SceneFrame>
    <path
      d="M92 100 v-34 l22 -16 l22 16 v34 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M150 100 v-52 h34 v52 Z"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M198 100 v-26 h26 v26 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M120 26 a34 22 0 0 0 60 0"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="4"
      strokeLinecap="round"
    />
    <circle cx="150" cy="48" r="9" fill="var(--sector)" />
  </SceneFrame>
);

/** Party vote shares as stacked segments. */
const Shares: FC = () => (
  <SceneFrame>
    {[
      { x: 60, w: 74, o: 1 },
      { x: 138, w: 52, o: 0.7 },
      { x: 194, w: 30, o: 0.45 },
      { x: 228, w: 18, o: 0.25 },
    ].map((s) => (
      <rect
        key={s.x}
        x={s.x}
        y="42"
        width={s.w}
        height="32"
        rx="4"
        fill="var(--sector)"
        opacity={s.o}
      />
    ))}
    <line
      x1="60"
      y1="86"
      x2="246"
      y2="86"
      stroke="currentColor"
      strokeWidth="2"
      opacity=".5"
    />
  </SceneFrame>
);

/** A map with one município picked out. */
const PlaceMap: FC = () => (
  <SceneFrame>
    <path
      d="M58 74 l26 -30 l34 8 l30 -22 l40 14 l36 -8 l18 26 l-26 34 l-44 6 l-38 -12 l-42 10 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      opacity=".65"
    />
    <path
      d="M148 30 l40 14 l-8 34 l-38 -12 Z"
      fill="var(--sector)"
      opacity=".35"
    />
    <circle cx="166" cy="52" r="7" fill="var(--sector)" />
  </SceneFrame>
);

/** Oblast tiles — a coarser grid than the município map. */
const Regions: FC = () => (
  <SceneFrame>
    {[0, 1, 2, 3, 4].map((i) =>
      [0, 1, 2].map((j) => (
        <rect
          key={`${i}-${j}`}
          x={62 + i * 36}
          y={22 + j * 28}
          width="30"
          height="22"
          rx="3"
          fill="var(--sector)"
          opacity={0.15 + ((i * 3 + j) % 5) * 0.16}
        />
      )),
    )}
  </SceneFrame>
);

/** Two rounds: a first-round pair, then the runoff. */
const Runoff: FC = () => (
  <SceneFrame>
    <Bars
      x={62}
      baseline={92}
      heights={[26, 34, 14, 10]}
      barWidth={14}
      gap={8}
    />
    <path
      d="M158 62 h22 m0 0 l-7 -7 m7 7 l-7 7"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <rect x="196" y="44" width="20" height="48" rx="3" fill="var(--sector)" />
    <rect
      x="224"
      y="60"
      width="20"
      height="32"
      rx="3"
      fill="var(--sector)"
      opacity=".4"
    />
  </SceneFrame>
);

/** Split control — a mayor's mark and a council's, in different accents. */
const SplitControl: FC = () => (
  <SceneFrame>
    <circle cx="112" cy="58" r="26" fill="var(--sector)" opacity=".9" />
    <path
      d="M170 34 h64 v48 h-64 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
    {[0, 1, 2].map((i) => (
      <rect
        key={i}
        x={178}
        y={42 + i * 14}
        width={48 - i * 12}
        height="8"
        rx="4"
        fill="currentColor"
        opacity=".45"
      />
    ))}
    <path
      d="M150 20 v76"
      stroke="currentColor"
      strokeWidth="2"
      strokeDasharray="5 5"
      opacity=".6"
    />
  </SceneFrame>
);

/** A magnifier over a distribution — the analyses. */
const Magnifier: FC = () => (
  <SceneFrame>
    <Bars
      x={58}
      baseline={96}
      heights={[18, 30, 44, 30, 20, 12]}
      barWidth={12}
      gap={6}
    />
    <circle
      cx="196"
      cy="50"
      r="28"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="4"
    />
    <path
      d="M216 70 l22 22"
      stroke="var(--sector)"
      strokeWidth="5"
      strokeLinecap="round"
    />
  </SceneFrame>
);

/** A stack of report sheets. */
const Reports: FC = () => (
  <SceneFrame>
    {[0, 1, 2].map((i) => (
      <rect
        key={i}
        x={104 + i * 12}
        y={20 + i * 8}
        width="86"
        height="76"
        rx="4"
        fill={PAPER}
        stroke="currentColor"
        strokeWidth="2"
      />
    ))}
    {[44, 60, 76].map((y, i) => (
      <rect
        key={y}
        x="140"
        y={y}
        width={54 - i * 12}
        height="6"
        rx="3"
        fill="var(--sector)"
        opacity={1 - i * 0.28}
      />
    ))}
  </SceneFrame>
);

/** A strong mandate — one dominant column against a threshold. */
const Mandate: FC = () => (
  <SceneFrame>
    <Bars
      x={72}
      baseline={96}
      heights={[64, 22, 16, 10]}
      barWidth={18}
      gap={12}
    />
    <line
      x1="60"
      y1="52"
      x2="248"
      y2="52"
      stroke="currentColor"
      strokeWidth="2"
      strokeDasharray="6 5"
      opacity=".6"
    />
  </SceneFrame>
);

/** A close race — two nearly equal columns. */
const CloseRace: FC = () => (
  <SceneFrame>
    <rect x="106" y="34" width="30" height="58" rx="3" fill="var(--sector)" />
    <rect
      x="150"
      y="38"
      width="30"
      height="54"
      rx="3"
      fill="var(--sector)"
      opacity=".55"
    />
    <path d="M100 26 h86" stroke="currentColor" strokeWidth="2" opacity=".6" />
    <path
      d="M196 60 h24"
      stroke="var(--sector)"
      strokeWidth="4"
      strokeLinecap="round"
    />
  </SceneFrame>
);

/** A partial election — a calendar with one day marked out of sequence. */
const Partial: FC = () => (
  <SceneFrame>
    <rect
      x="98"
      y="22"
      width="104"
      height="80"
      rx="5"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="2"
    />
    <line
      x1="98"
      y1="42"
      x2="202"
      y2="42"
      stroke="currentColor"
      strokeWidth="2"
    />
    {[0, 1, 2, 3].map((i) =>
      [0, 1, 2].map((j) => (
        <circle
          key={`${i}-${j}`}
          cx={114 + i * 24}
          cy={58 + j * 18}
          r="5"
          fill={i === 2 && j === 1 ? "var(--sector)" : "currentColor"}
          opacity={i === 2 && j === 1 ? 1 : 0.28}
        />
      )),
    )}
  </SceneFrame>
);

/** Reconciliation — two lists compared row by row. */
const Reconcile: FC = () => (
  <SceneFrame>
    {[0, 1].map((col) => (
      <g key={col}>
        <rect
          x={78 + col * 92}
          y="22"
          width="72"
          height="76"
          rx="4"
          fill={PAPER}
          stroke="currentColor"
          strokeWidth="2"
        />
        {[38, 54, 70, 84].map((y) => (
          <rect
            key={y}
            x={88 + col * 92}
            y={y}
            width="50"
            height="6"
            rx="3"
            fill="currentColor"
            opacity=".35"
          />
        ))}
      </g>
    ))}
    <path
      d="M156 54 h14 m-14 16 h14"
      stroke="var(--sector)"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </SceneFrame>
);

/** Swing — the change between two cycles. */
const Swing: FC = () => (
  <SceneFrame>
    <TrendLine
      points={[
        [64, 84],
        [104, 62],
        [146, 70],
        [188, 40],
        [232, 30],
      ]}
      arrow
    />
    <Donut cx={252} cy={78} r={14} pct={62} thickness={6} />
  </SceneFrame>
);

/**
 * Round 1's field narrowing to a runoff pair, and the single office it elects.
 *
 * ⚠ THE EMBLEM IS ANCHORED AT THE LEFT EDGE, OUT OF THE FLOW. It sat between the field and
 * the arrow in the first cut, which put the office in the middle of the very narrowing the
 * arrow describes — field → office → arrow → pair reads as a sequence nobody meant. `Runoff`
 * two scenes up sets the convention: bars → arrow → pair, contiguous and left to right.
 *
 * ⚠ FOUR BARS, NOT TWO. A field of two narrowing to a pair of two is not a narrowing, and it
 * was two until this tile first shipped to the page.
 */
const Presidency: FC = () => (
  <SceneFrame>
    {/* the single office it elects */}
    <circle cx="80" cy="40" r="16" fill="var(--sector)" />
    <path
      d="M56 92 a24 26 0 0 1 48 0 z"
      fill="var(--sector)"
      opacity=".45"
      stroke="currentColor"
      strokeWidth="2"
    />
    {/* round 1's field → the runoff pair */}
    <Bars
      x={126}
      baseline={92}
      heights={[18, 30, 14, 10]}
      barWidth={12}
      gap={8}
    />
    <path
      d="M216 66 h20 m0 0 l-6 -6 m6 6 l-6 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <rect x="248" y="52" width="18" height="40" rx="3" fill="var(--sector)" />
    <rect
      x="270"
      y="70"
      width="18"
      height="22"
      rx="3"
      fill="var(--sector)"
      opacity=".4"
    />
  </SceneFrame>
);

export const ELECTIONS_SCENES: Record<string, FC> = {
  parliamentary: Hemicycle,
  presidential: Presidency,
  local: Mayor,
  "mayors-by-party": Ballot,
  "council-votes": Shares,
  municipalities: PlaceMap,
  regions: Regions,
  runoffs: Runoff,
  "split-control": SplitControl,
  "analysis-hub": Magnifier,
  "reports-hub": Reports,
  "strongest-mandates": Mandate,
  "closest-races": CloseRace,
  chmi: Partial,
  sverka: Reconcile,
  swing: Swing,
};
