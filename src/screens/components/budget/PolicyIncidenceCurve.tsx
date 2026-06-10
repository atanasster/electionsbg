// Winners/losers incidence strip for the policy simulator: Δ net effect per
// month (net pay + VAT-on-spending) across the gross-salary range, as a bar
// row around a zero axis — green gains above, red losses below. Pure SVG,
// same hand-rolled idiom as TaxRateCurve.

import { FC } from "react";

export interface IncidencePoint {
  grossEur: number;
  deltaEur: number;
}

const W = 560;
const H = 170;
const PAD_L = 44;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 24;

export const PolicyIncidenceCurve: FC<{
  points: IncidencePoint[];
  locale: string;
  capEur?: number;
  ariaLabel?: string;
}> = ({ points, locale, capEur, ariaLabel }) => {
  if (points.length < 2) return null;
  const minG = points[0].grossEur;
  const maxG = points[points.length - 1].grossEur;
  const maxAbs = Math.max(1, ...points.map((p) => Math.abs(p.deltaEur)));
  const x = (g: number) =>
    PAD_L + ((g - minG) / (maxG - minG)) * (W - PAD_L - PAD_R);
  const zeroY = PAD_T + (H - PAD_T - PAD_B) / 2;
  const y = (d: number) => zeroY - (d / maxAbs) * (H - PAD_T - PAD_B) * 0.5;
  const barW = ((W - PAD_L - PAD_R) / points.length) * 0.72;
  const fmt = (v: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v);
  // BG convention: "{n} €"; EN: "€{n}".
  const money = (v: number) =>
    locale.startsWith("bg") ? `${fmt(v)} €` : `€${fmt(v)}`;

  const xTicks = [];
  for (let g = 1000; g < maxG; g += 1000) xTicks.push(g);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={ariaLabel ?? "incidence"}
    >
      {/* y guide labels: +max / 0 / −max */}
      {[maxAbs, 0, -maxAbs].map((v) => (
        <g key={v}>
          <text
            x={PAD_L - 5}
            y={y(v) + 3}
            textAnchor="end"
            className="fill-muted-foreground"
            fontSize="9"
          >
            {v > 0 ? "+" : v < 0 ? "−" : ""}
            {money(Math.abs(v))}
          </text>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={y(v)}
            y2={y(v)}
            className={v === 0 ? "stroke-border" : "stroke-border/40"}
            strokeWidth={v === 0 ? 1 : 0.5}
          />
        </g>
      ))}
      {/* МОД cap marker */}
      {capEur && capEur > minG && capEur < maxG ? (
        <g>
          <line
            x1={x(capEur)}
            x2={x(capEur)}
            y1={PAD_T}
            y2={H - PAD_B}
            className="stroke-amber-500/60"
            strokeDasharray="3 3"
            strokeWidth={1}
          />
          <text
            x={x(capEur)}
            y={PAD_T + 8}
            textAnchor="middle"
            className="fill-amber-600 dark:fill-amber-400"
            fontSize="8"
          >
            МОД
          </text>
        </g>
      ) : null}
      {/* bars */}
      {points.map((p) => {
        const by = y(p.deltaEur);
        const h = Math.abs(by - zeroY);
        if (h < 0.5) return null;
        return (
          <rect
            key={p.grossEur}
            x={x(p.grossEur) - barW / 2}
            y={Math.min(by, zeroY)}
            width={barW}
            height={h}
            className={
              p.deltaEur >= 0 ? "fill-emerald-500/70" : "fill-red-500/70"
            }
          >
            <title>{`${money(p.grossEur)}: ${p.deltaEur >= 0 ? "+" : "−"}${money(Math.abs(p.deltaEur))}`}</title>
          </rect>
        );
      })}
      {/* x ticks */}
      {xTicks.map((g) => (
        <text
          key={g}
          x={x(g)}
          y={H - PAD_B + 14}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize="9"
        >
          {money(g)}
        </text>
      ))}
    </svg>
  );
};
