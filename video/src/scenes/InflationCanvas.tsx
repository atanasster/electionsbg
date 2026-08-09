import React from "react";
import { THEME } from "../theme";
import DATA from "../generated/inflation.json";
import type { CanvasState } from "../lib/canvasState";

/**
 * The persistent chart for the inflation explainer.
 *
 * Carries the CHROME a social card deliberately strips — y-axis with ticks and a
 * unit, x-axis with year labels, gridlines, a benchmark line, direct series
 * labels. That chrome is not decoration: it is what lets a viewer check the claim
 * instead of taking it, and it is most of the difference between a card and an
 * explainer.
 *
 * Driven entirely by an interpolated `CanvasState` on ABSOLUTE time — it renders
 * outside every `<Sequence>` so it can persist and accrete. See lib/canvasState.ts.
 */

const PAD = { l: 96, r: 210, t: 28, b: 64 };

type Series = { p: string; v: number }[];
const BG = DATA.series.BG as Series;
const EU = DATA.series.EU as Series;
const RO = DATA.series.RO as Series;
const HR = DATA.series.HR as Series;

const yearOf = (period: string) => Number(period.slice(0, 4));

export const InflationCanvas: React.FC<{
  state: CanvasState;
  width: number;
  height: number;
}> = ({ state, width, height }) => {
  const pal = THEME.dark;
  const w = width;
  const h = height;
  const plotW = w - PAD.l - PAD.r;
  const plotH = h - PAD.t - PAD.b;

  const { from, to, yMax } = state;
  const span = Math.max(1e-6, to - from);
  const x = (i: number) => PAD.l + ((i - from) / span) * plotW;
  const y = (v: number) => PAD.t + plotH - (v / yMax) * plotH;

  /** Clip to the plot so a wide window cannot draw over the axis labels. */
  const clipId = "plot-clip";

  const linePath = (s: Series) => {
    const pts: string[] = [];
    // One index either side of the window so the line enters and leaves cleanly.
    const lo = Math.max(0, Math.floor(from) - 1);
    const hi = Math.min(s.length - 1, Math.ceil(to) + 1);
    for (let i = lo; i <= hi; i++) {
      const pt = s[i];
      if (!pt) continue;
      pts.push(
        `${pts.length ? "L" : "M"}${x(i).toFixed(1)},${y(pt.v).toFixed(1)}`,
      );
    }
    return pts.join(" ");
  };

  // Y ticks on a round step, so labels land on the gridlines they name.
  const step = yMax > 12 ? 4 : yMax > 6 ? 2 : 1;
  const ticks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(v);

  // X labels: one per year, thinned so they never collide at a wide window.
  const yearIdx: { i: number; year: number }[] = [];
  for (
    let i = Math.max(0, Math.floor(from));
    i <= Math.min(BG.length - 1, Math.ceil(to));
    i++
  ) {
    const pt = BG[i];
    if (!pt || !pt.p.endsWith("Q1")) continue;
    yearIdx.push({ i, year: yearOf(pt.p) });
  }
  const everyN = Math.max(1, Math.ceil(yearIdx.length / 9));
  const xLabels = yearIdx.filter((_, k) => k % everyN === 0);

  const last = BG.length - 1;
  const showLatest = state.latestDot > 0.01 && to >= last - 0.5;

  const SERIES: {
    s: Series;
    o: number;
    c: string;
    label: string;
    dash?: string;
  }[] = [
    { s: RO, o: state.ro, c: "#8f7bd6", label: "Румъния" },
    { s: HR, o: state.hr, c: "#5fa8d3", label: "Хърватия" },
    { s: EU, o: state.eu, c: pal.muted, label: "ЕС средно", dash: "10 8" },
    { s: BG, o: state.bg, c: pal.accent, label: "България" },
  ];

  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <defs>
        <clipPath id={clipId}>
          <rect x={PAD.l} y={PAD.t} width={plotW} height={plotH} />
        </clipPath>
      </defs>

      {/* gridlines + y labels */}
      {ticks.map((v) => (
        <g key={v}>
          <line
            x1={PAD.l}
            x2={PAD.l + plotW}
            y1={y(v)}
            y2={y(v)}
            stroke={pal.rule}
            strokeWidth={v === 0 ? 2 : 1}
            opacity={v === 0 ? 0.9 : 0.45}
          />
          <text
            x={PAD.l - 18}
            y={y(v) + 9}
            textAnchor="end"
            fill={pal.muted}
            fontSize={26}
            fontWeight={600}
          >
            {v}%
          </text>
        </g>
      ))}

      {/* x year labels */}
      {xLabels.map(({ i, year }) => (
        <text
          key={year}
          x={x(i)}
          y={PAD.t + plotH + 42}
          textAnchor="middle"
          fill={pal.muted}
          fontSize={24}
          fontWeight={600}
        >
          {year}
        </text>
      ))}

      <g clipPath={`url(#${clipId})`}>
        {/* highlighted stretch */}
        {state.band ? (
          <rect
            x={x(state.band[0])}
            y={PAD.t}
            width={Math.max(2, x(state.band[1]) - x(state.band[0]))}
            height={plotH}
            fill={pal.accent}
            opacity={0.12}
          />
        ) : null}

        {/* euro-adoption rule */}
        {state.marker != null ? (
          <g>
            <line
              x1={x(state.marker)}
              x2={x(state.marker)}
              y1={PAD.t}
              y2={PAD.t + plotH}
              stroke={pal.text}
              strokeWidth={2}
              strokeDasharray="8 8"
              opacity={0.7}
            />
            <text
              x={x(state.marker) + 12}
              y={PAD.t + 30}
              fill={pal.text}
              fontSize={24}
              fontWeight={700}
              opacity={0.85}
            >
              еврото
            </text>
          </g>
        ) : null}

        {SERIES.map(({ s, o, c, dash }, k) =>
          o < 0.01 ? null : (
            <path
              key={k}
              d={linePath(s)}
              fill="none"
              stroke={c}
              strokeWidth={k === 3 ? 5 : 3}
              strokeDasharray={dash}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={o}
            />
          ),
        )}

        {showLatest ? (
          <circle
            cx={x(last)}
            cy={y(BG[last]!.v)}
            r={11}
            fill={pal.accent}
            opacity={state.latestDot}
          />
        ) : null}
      </g>

      {/* direct end labels — identity without a separate legend to read */}
      {SERIES.map(({ s, o, c, label }, k) => {
        if (o < 0.01) return null;
        const i = Math.min(s.length - 1, Math.floor(to));
        const pt = s[i];
        if (!pt) return null;
        return (
          <text
            key={`l${k}`}
            x={PAD.l + plotW + 16}
            y={y(pt.v) + 9}
            fill={c}
            fontSize={26}
            fontWeight={700}
            opacity={o}
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
};
