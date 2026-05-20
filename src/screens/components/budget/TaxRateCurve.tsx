// Effective-rate curve — a small inline-SVG chart showing how the combined
// tax-and-contribution rate moves across the salary range. The downward kink
// at the МОД cap visualises the regressive flip the calculator otherwise only
// describes in words: once social security stops accruing, each extra euro is
// taxed at just the 10% income-tax rate, so the effective rate falls.

import { FC } from "react";

export interface CurvePoint {
  gross: number;
  rate: number;
}

const W = 320;
const H = 132;
const PAD_L = 6;
const PAD_R = 6;
const PAD_T = 16;
const PAD_B = 24;

export const TaxRateCurve: FC<{
  points: CurvePoint[];
  current: CurvePoint;
  capGross: number | null;
  minGross: number;
  maxGross: number;
  locale: string;
  capLabel: string;
}> = ({ points, current, capGross, minGross, maxGross, locale, capLabel }) => {
  if (points.length < 2 || maxGross <= minGross) return null;

  const peak = Math.max(...points.map((p) => p.rate), current.rate);
  // Round the y-axis ceiling up to the next 5 percentage points.
  const yMax = Math.max(0.05, Math.ceil(peak * 20) / 20);

  const x = (g: number): number =>
    PAD_L + ((g - minGross) / (maxGross - minGross)) * (W - PAD_L - PAD_R);
  const y = (r: number): number => PAD_T + (1 - r / yMax) * (H - PAD_T - PAD_B);

  const path = points.map((p) => `${x(p.gross)},${y(p.rate)}`).join(" ");

  const eur0 = (v: number): string =>
    `€${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v)}`;
  const pct0 = (v: number): string =>
    `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
      v * 100,
    )}%`;

  const showCap =
    capGross != null && capGross > minGross && capGross < maxGross;
  const curX = x(current.gross);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`${pct0(current.rate)} @ ${eur0(current.gross)}`}
    >
      {/* baseline */}
      <line
        x1={PAD_L}
        y1={y(0)}
        x2={W - PAD_R}
        y2={y(0)}
        className="stroke-border"
        strokeWidth={1}
      />

      {/* МОД cap line */}
      {showCap ? (
        <>
          <line
            x1={x(capGross as number)}
            y1={PAD_T}
            x2={x(capGross as number)}
            y2={y(0)}
            className="stroke-amber-500"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <text
            x={x(capGross as number)}
            y={PAD_T - 5}
            textAnchor="middle"
            className="fill-amber-600 dark:fill-amber-400"
            fontSize={9}
          >
            {capLabel}
          </text>
        </>
      ) : null}

      {/* the curve */}
      <polyline
        points={path}
        fill="none"
        className="stroke-indigo-500"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* current-salary marker */}
      <line
        x1={curX}
        y1={PAD_T}
        x2={curX}
        y2={y(0)}
        className="stroke-foreground/25"
        strokeWidth={1}
      />
      <circle
        cx={curX}
        cy={y(current.rate)}
        r={3.5}
        className="fill-indigo-600 stroke-background"
        strokeWidth={1.5}
      />
      <text
        x={Math.min(W - PAD_R, Math.max(PAD_L + 18, curX))}
        y={Math.max(PAD_T + 8, y(current.rate) - 7)}
        textAnchor="middle"
        className="fill-foreground"
        fontSize={9}
        fontWeight={700}
      >
        {pct0(current.rate)}
      </text>

      {/* x-axis range labels */}
      <text x={PAD_L} y={H - 7} className="fill-muted-foreground" fontSize={9}>
        {eur0(minGross)}
      </text>
      <text
        x={W - PAD_R}
        y={H - 7}
        textAnchor="end"
        className="fill-muted-foreground"
        fontSize={9}
      >
        {eur0(maxGross)}
      </text>
    </svg>
  );
};
