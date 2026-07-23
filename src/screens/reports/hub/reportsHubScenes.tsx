// Infographic scenes for the /reports hub tiles (ReportsHubScreen) and the
// curated "Доклади" strip on /analysis. Same SceneFrame contract as the sector /
// analysis scenes (see src/ux/infographic/README.md): ink via currentColor, the
// accent via var(--sector), PAPER for under-ink fills; decorative (aria-hidden).
// Two tiles carry a stat overlay (riskScore, turnout), so those keep their dense
// marks off the lower-left (~x < 170); the rest may use the whole canvas.

/* eslint-disable react-refresh/only-export-components -- REPORT_SCENES is a
   lookup table of scene components, not a fast-refresh boundary. */
import { FC } from "react";
import { SceneFrame, PAPER, Bars, TrendLine } from "@/ux/infographic";

// Скрининг на риска — a gauge with the needle in the high zone. (has a metric →
// keep the marks right of centre.)
const RiskScore: FC = () => (
  <SceneFrame>
    <path
      d="M188 92 A48 48 0 0 1 284 92"
      fill="none"
      stroke="currentColor"
      strokeWidth="6"
      opacity=".22"
      strokeLinecap="round"
    />
    <path
      d="M244 47 A48 48 0 0 1 284 92"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="6"
      strokeLinecap="round"
    />
    <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M236 92 L268 64" />
    </g>
    <circle cx="236" cy="92" r="4" fill="var(--sector)" />
  </SceneFrame>
);

// Проблемни секции — a warning triangle over a small grid of section cells.
const Problem: FC = () => (
  <SceneFrame>
    <g fill="currentColor" opacity=".16">
      {[0, 1, 2, 3].map((c) =>
        [0, 1, 2].map((r) => (
          <rect
            key={`${c}-${r}`}
            x={180 + c * 20}
            y={64 + r * 16}
            width="15"
            height="11"
            rx="2"
          />
        )),
      )}
    </g>
    <path
      d="M222 20 L252 68 H192 Z"
      fill="var(--sector)"
      opacity=".18"
      stroke="var(--sector)"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <g stroke={PAPER} strokeWidth="3" strokeLinecap="round">
      <path d="M222 36 V52" />
    </g>
    <circle cx="222" cy="60" r="2.2" fill={PAPER} />
  </SceneFrame>
);

// Концентрирани гласове — scattered dots funnel into one dense cluster.
const Concentration: FC = () => (
  <SceneFrame>
    <g fill="currentColor" opacity=".4">
      <circle cx="176" cy="34" r="3" />
      <circle cx="192" cy="86" r="3" />
      <circle cx="182" cy="60" r="3" />
      <circle cx="206" cy="46" r="3" />
      <circle cx="206" cy="74" r="3" />
    </g>
    <g stroke="currentColor" strokeWidth="1" opacity=".3">
      <path d="M176 34 L256 58 M192 86 L256 58 M182 60 L256 58 M206 46 L256 58 M206 74 L256 58" />
    </g>
    <circle cx="256" cy="58" r="18" fill="var(--sector)" opacity=".85" />
    <circle
      cx="256"
      cy="58"
      r="26"
      fill="none"
      stroke="var(--sector)"
      strokeWidth="1.4"
      opacity=".5"
    />
  </SceneFrame>
);

// Допълнителни избиратели — a voter roll with a + badge (names added on the day).
const Additional: FC = () => (
  <SceneFrame>
    <rect
      x="188"
      y="28"
      width="64"
      height="60"
      rx="4"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <g
      stroke="currentColor"
      strokeWidth="2"
      opacity=".55"
      strokeLinecap="round"
    >
      <path d="M198 42 h30 M198 54 h30 M198 66 h20" />
    </g>
    <circle cx="252" cy="80" r="12" fill="var(--sector)" />
    <path
      d="M252 74 v12 M246 80 h12"
      stroke={PAPER}
      strokeWidth="2.4"
      strokeLinecap="round"
    />
  </SceneFrame>
);

// Не подкрепям никого — a ballot with only the "none" line marked.
const NoOne: FC = () => (
  <SceneFrame>
    <rect
      x="196"
      y="24"
      width="52"
      height="68"
      rx="4"
      fill={PAPER}
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <g
      stroke="currentColor"
      strokeWidth="2"
      opacity=".35"
      strokeLinecap="round"
    >
      <path d="M206 38 h32 M206 50 h32 M206 62 h32" />
    </g>
    <rect
      x="202"
      y="72"
      width="40"
      height="12"
      rx="2"
      fill="var(--sector)"
      opacity=".2"
    />
    <path
      d="M208 78 h28"
      stroke="var(--sector)"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
  </SceneFrame>
);

// Изборна активност — a row of voter figures, some filled (turned out). (metric)
const Turnout: FC = () => (
  <SceneFrame>
    {[0, 1, 2, 3].map((i) => {
      const x = 190 + i * 26;
      const on = i > 1;
      return (
        <g
          key={i}
          fill={on ? "var(--sector)" : "currentColor"}
          opacity={on ? 0.85 : 0.3}
        >
          <circle cx={x} cy={44} r="7" />
          <path d={`M${x - 10} 92 v-16 a10 10 0 0 1 20 0 v16 Z`} />
        </g>
      );
    })}
  </SceneFrame>
);

// Невалидни бюлетини — a ballot voided with a big X and a stamp.
const Invalid: FC = () => (
  <SceneFrame>
    <g transform="rotate(-8 232 58)">
      <rect
        x="206"
        y="26"
        width="52"
        height="66"
        rx="4"
        fill={PAPER}
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <g
        stroke="currentColor"
        strokeWidth="2"
        opacity=".3"
        strokeLinecap="round"
      >
        <path d="M216 40 h32 M216 52 h32" />
      </g>
      <path
        d="M212 34 L252 84 M252 34 L212 84"
        stroke="var(--sector)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </g>
  </SceneFrame>
);

// Най-печеливши — rising bars with an up arrow.
const Gainers: FC = () => (
  <SceneFrame>
    <Bars
      x={182}
      baseline={98}
      heights={[22, 38, 54, 72]}
      barWidth={14}
      gap={7}
    />
    <TrendLine
      points={[
        [186, 76],
        [210, 62],
        [234, 46],
        [264, 26],
      ]}
      arrow
    />
  </SceneFrame>
);

// Най-губещи — falling bars with a down arrow.
const Losers: FC = () => (
  <SceneFrame>
    <Bars
      x={182}
      baseline={98}
      heights={[72, 54, 38, 22]}
      barWidth={14}
      gap={7}
      opacityRamp={false}
    />
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M186 30 L210 46 L234 62 L264 82" />
      <path d="M264 82 l-2 -12 M264 82 l-12 2" />
    </g>
  </SceneFrame>
);

// Повторно преброяване — two ballot stacks with a difference (≠) between them.
const Recount: FC = () => (
  <SceneFrame>
    <g fill="var(--sector)" opacity=".7">
      <rect x="182" y="78" width="34" height="8" rx="2" />
      <rect x="184" y="68" width="30" height="8" rx="2" opacity=".8" />
      <rect x="186" y="58" width="26" height="8" rx="2" opacity=".6" />
    </g>
    <g fill="currentColor" opacity=".4">
      <rect x="252" y="78" width="34" height="8" rx="2" />
      <rect x="254" y="68" width="30" height="8" rx="2" />
    </g>
    <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M228 54 h18 M228 64 h18 M232 47 l10 24" />
    </g>
  </SceneFrame>
);

// Флаш памет — a memory chip with pins; one slot missing.
const Flash: FC = () => (
  <SceneFrame>
    <rect
      x="198"
      y="38"
      width="56"
      height="42"
      rx="4"
      fill="var(--sector)"
      opacity=".16"
      stroke="var(--sector)"
      strokeWidth="2"
    />
    <rect
      x="212"
      y="50"
      width="28"
      height="18"
      rx="2"
      fill="var(--sector)"
      opacity=".6"
    />
    <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".7">
      <path d="M206 80 v8 M218 80 v8 M234 80 v8 M246 80 v8" />
      <path d="M206 30 v8 M218 30 v8 M234 30 v8 M246 30 v8" />
    </g>
    <path
      d="M264 44 l14 14 M278 44 l-14 14"
      stroke="var(--sector)"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
  </SceneFrame>
);

export const REPORT_SCENES: Record<string, FC> = {
  riskScore: RiskScore,
  problem: Problem,
  concentration: Concentration,
  additional: Additional,
  noOne: NoOne,
  turnout: Turnout,
  invalid: Invalid,
  gainers: Gainers,
  losers: Losers,
  recount: Recount,
  flash: Flash,
};
