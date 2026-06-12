// Winners/losers by wage decile for the policy simulator: one diverging bar
// per tenth of wage earners (poorest → richest), mean Δ net effect per month
// (net pay + VAT-on-spending). The citizen-legible summary of the incidence
// curve — pure SVG, same hand-rolled idiom as PolicyIncidenceCurve.

import { FC } from "react";

const W = 560;
const H = 150;
const PAD_L = 44;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 26;

export const PolicyDecileStrip: FC<{
  /** Mean Δ EUR/month per decile, poorest first (length 10). */
  deciles: number[];
  locale: string;
  labelLow: string;
  labelHigh: string;
  ariaLabel?: string;
}> = ({ deciles, locale, labelLow, labelHigh, ariaLabel }) => {
  if (deciles.length === 0) return null;
  const maxAbs = Math.max(1, ...deciles.map((d) => Math.abs(d)));
  const zeroY = PAD_T + (H - PAD_T - PAD_B) / 2;
  const y = (d: number) => zeroY - (d / maxAbs) * (H - PAD_T - PAD_B) * 0.5;
  const slot = (W - PAD_L - PAD_R) / deciles.length;
  const barW = slot * 0.6;
  const x = (i: number) => PAD_L + slot * i + slot / 2;
  const fmt = (v: number) =>
    new Intl.NumberFormat(locale, {
      maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0,
    }).format(v);
  const money = (v: number) =>
    locale.startsWith("bg") ? `${fmt(v)} €` : `€${fmt(v)}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={ariaLabel ?? "deciles"}
    >
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
      {deciles.map((d, i) => {
        const by = y(d);
        const h = Math.abs(by - zeroY);
        const positive = d >= 0;
        return (
          <g key={i}>
            {h >= 0.5 ? (
              <rect
                x={x(i) - barW / 2}
                y={Math.min(by, zeroY)}
                width={barW}
                height={h}
                rx={2}
                className={positive ? "fill-emerald-500/70" : "fill-red-500/70"}
              >
                <title>{`D${i + 1}: ${positive ? "+" : "−"}${money(Math.abs(d))}`}</title>
              </rect>
            ) : null}
            {/* per-bar value label, on the bar's outer end */}
            {h >= 8 ? (
              <text
                x={x(i)}
                y={positive ? by - 3 : by + 9}
                textAnchor="middle"
                className={
                  positive
                    ? "fill-emerald-700 dark:fill-emerald-400"
                    : "fill-red-700 dark:fill-red-400"
                }
                fontSize="8"
              >
                {positive ? "+" : "−"}
                {fmt(Math.abs(d))}
              </text>
            ) : null}
            <text
              x={x(i)}
              y={H - PAD_B + 12}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize="8"
            >
              {i + 1}
            </text>
          </g>
        );
      })}
      <text
        x={PAD_L}
        y={H - 2}
        textAnchor="start"
        className="fill-muted-foreground"
        fontSize="8"
      >
        ← {labelLow}
      </text>
      <text
        x={W - PAD_R}
        y={H - 2}
        textAnchor="end"
        className="fill-muted-foreground"
        fontSize="8"
      >
        {labelHigh} →
      </text>
    </svg>
  );
};
