// Infographic scenes for the /analysis hub tiles (AnalysisHubScreen). Same
// SceneFrame contract as the sector / procurement scenes (see
// src/ux/infographic/README.md): structural ink via currentColor, the accent via
// var(--sector), PAPER for under-ink fills; decorative (aria-hidden via the
// frame). Every analysis tile overlays a big stat number at the banner's
// bottom-left, so — per the "stat overlay" rule — these compositions keep their
// dense marks on the RIGHT half / top and leave the lower-left (~x < 170) clear.

/* eslint-disable react-refresh/only-export-components -- ANALYSIS_SCENES is a
   lookup table of scene components, not a fast-refresh boundary. */
import { FC } from "react";
import { SceneFrame, PAPER, Bars, TrendLine, Donut } from "@/ux/infographic";

// Изборен риск — a shield (top-right) with an alert mark; a few section ticks
// escalate toward it.
const Risk: FC = () => (
  <SceneFrame>
    <path
      d="M232 18 l30 10 v22 c0 20 -14 30 -30 38 c-16 -8 -30 -18 -30 -38 V28 Z"
      fill="var(--sector)"
      opacity=".16"
      stroke="var(--sector)"
      strokeWidth="2"
    />
    <g stroke={PAPER} strokeWidth="3" strokeLinecap="round">
      <path d="M232 34 V56" />
    </g>
    <circle cx="232" cy="66" r="2.4" fill={PAPER} />
    <g fill="var(--sector)">
      <rect x="176" y="86" width="8" height="14" rx="2" opacity=".45" />
      <rect x="190" y="78" width="8" height="22" rx="2" opacity=".65" />
      <rect x="204" y="66" width="8" height="34" rx="2" opacity=".85" />
    </g>
  </SceneFrame>
);

// Законът на Бенфорд — the descending first-digit histogram with the ideal
// Benford curve traced over it.
const Benford: FC = () => (
  <SceneFrame>
    <Bars
      x={176}
      baseline={100}
      heights={[46, 34, 27, 21, 17, 14, 11, 9]}
      barWidth={10}
      gap={4}
      opacityRamp={false}
    />
    <TrendLine
      points={[
        [181, 54],
        [195, 66],
        [209, 73],
        [223, 79],
        [237, 83],
        [251, 86],
        [265, 89],
        [277, 91],
      ]}
    />
  </SceneFrame>
);

// Изгубени гласове — a ballot marked X tipping toward a bin; the vote below the
// threshold is discarded.
const Wasted: FC = () => (
  <SceneFrame>
    <g transform="rotate(12 232 46)">
      <rect
        x="212"
        y="24"
        width="40"
        height="48"
        rx="3"
        fill={PAPER}
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M220 40 l10 10 M230 40 l-10 10"
        stroke="var(--sector)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path d="M218 60 h28" stroke="currentColor" strokeWidth="1.4" />
    </g>
    <g stroke="currentColor" strokeWidth="1.8" fill="none">
      <path d="M198 84 h44 l-4 20 h-36 Z" fill="var(--sector)" opacity=".16" />
      <path d="M198 84 h44 l-4 20 h-36 Z" />
      <path d="M208 90 v10 M220 90 v10 M232 90 v10" opacity=".7" />
    </g>
  </SceneFrame>
);

// Лоялност на гласоподавателите — a retention donut with a flow ribbon feeding
// the parties that stayed.
const Persistence: FC = () => (
  <SceneFrame>
    <path
      d="M176 40 C210 40 214 58 250 58"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="6"
      opacity=".28"
      strokeLinecap="round"
    />
    <path
      d="M176 78 C210 78 214 58 250 58"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      opacity=".3"
      strokeLinecap="round"
    />
    <Donut cx={258} cy={58} r={18} pct={0.62} />
  </SceneFrame>
);

// Сравнение — two grouped bars (A vs B) astride a divider.
const Compare: FC = () => (
  <SceneFrame>
    <path
      d="M232 22 V96"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeDasharray="4 5"
      opacity=".5"
    />
    <g>
      <rect
        x="196"
        y="52"
        width="14"
        height="44"
        rx="2"
        fill="currentColor"
        opacity=".32"
      />
      <rect
        x="214"
        y="66"
        width="14"
        height="30"
        rx="2"
        fill="currentColor"
        opacity=".22"
      />
      <rect
        x="238"
        y="40"
        width="14"
        height="56"
        rx="2"
        fill="var(--sector)"
        opacity=".85"
      />
      <rect
        x="256"
        y="58"
        width="14"
        height="38"
        rx="2"
        fill="var(--sector)"
        opacity=".55"
      />
    </g>
  </SceneFrame>
);

// Симулатор на коалиции — a parliament hemicycle of seat dots, the accent seats
// forming a majority arc.
const Simulator: FC = () => {
  const cx = 236;
  const cy = 96;
  const dots: { x: number; y: number; on: boolean }[] = [];
  const rings = [30, 44, 58];
  rings.forEach((r, ri) => {
    const n = 6 + ri * 3;
    for (let i = 0; i < n; i++) {
      const a = Math.PI - (Math.PI * i) / (n - 1);
      dots.push({
        x: cx + r * Math.cos(a),
        y: cy - r * Math.sin(a),
        on: i / (n - 1) < 0.5,
      });
    }
  });
  return (
    <SceneFrame>
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.x}
          cy={d.y}
          r={3.1}
          fill={d.on ? "var(--sector)" : "currentColor"}
          opacity={d.on ? 0.85 : 0.28}
        />
      ))}
    </SceneFrame>
  );
};

// Точност на проучванията — a bullseye with a marker just off centre (the poll's
// error vs the actual result).
const Polls: FC = () => (
  <SceneFrame>
    <g fill="none" stroke="currentColor">
      <circle cx="236" cy="58" r="34" strokeWidth="1.4" opacity=".3" />
      <circle cx="236" cy="58" r="22" strokeWidth="1.4" opacity=".45" />
    </g>
    <circle cx="236" cy="58" r="10" fill="var(--sector)" opacity=".2" />
    <circle cx="236" cy="58" r="3.2" fill="var(--sector)" />
    <circle
      cx="252"
      cy="46"
      r="4.4"
      fill={PAPER}
      stroke="var(--sector)"
      strokeWidth="2.4"
    />
  </SceneFrame>
);

// Финансиране на кампанията — a coin jar filling with accent coins.
const Financing: FC = () => (
  <SceneFrame>
    <path
      d="M206 44 h56 v42 a8 8 0 0 1 -8 8 h-40 a8 8 0 0 1 -8 -8 Z"
      fill="var(--sector)"
      opacity=".12"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <path
      d="M202 44 h64"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <g fill="var(--sector)">
      <ellipse cx="234" cy="70" rx="16" ry="6" opacity=".55" />
      <ellipse cx="234" cy="80" rx="16" ry="6" opacity=".75" />
      <ellipse cx="234" cy="90" rx="16" ry="6" />
    </g>
    <g fill="var(--sector)">
      <circle cx="252" cy="30" r="7" opacity=".8" />
      <path d="M249 30 h6 M252 27 v6" stroke={PAPER} strokeWidth="1.4" />
    </g>
  </SceneFrame>
);

export const ANALYSIS_SCENES: Record<string, FC> = {
  risk: Risk,
  benford: Benford,
  wasted: Wasted,
  persistence: Persistence,
  compare: Compare,
  simulator: Simulator,
  polls: Polls,
  financing: Financing,
};
