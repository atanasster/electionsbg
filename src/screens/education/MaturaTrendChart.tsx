// The national ДЗИ БЕЛ trend, on a real date axis with the governments strip
// under it. Two things the sparkline it replaced could not do:
//
//  1. Each point sits on the day that cohort actually sat the exam (third week
//     of May — see maturaCalendar), so the x axis is genuinely linear in time
//     and the cabinet bands below line up with the dots by construction rather
//     than by "the gaps happen to be equal".
//  2. Cohort size rides along as faint bars in a band of their own — the
//     denominator behind the average, kept visually subordinate (bars, not a
//     second line, so nobody reads the two series as comparable trends).
//
// Inline SVG drawn at the measured width, like the ContextScatter below it on
// this page: /education otherwise loads no chart vendor at all, and a stretched
// viewBox would scale the tick type with the container. Drawing in CSS pixels
// also makes the cabinet strip's padLeft exact instead of estimated.
//
// The strip is context, not causation: a matura score is twelve years of
// schooling, not the tenure of whoever happened to be PM on exam day. The
// caption says so.

import { FC, useMemo } from "react";
import { useGovernments } from "@/data/governments/useGovernments";
import { ChartCabinetStrip } from "@/screens/components/governments/ChartCabinetStrip";
import { useMeasuredWidth } from "@/ux/useMeasuredWidth";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { useTooltip } from "@/ux/useTooltip";
import {
  buildMaturaRows,
  cohortMax,
  fromFractionalYear,
  scoreDomain,
  scoreTicks,
  X_PAD,
  type MaturaYear,
} from "./maturaTrend";

const H = 210;
// Plot split: the score line owns the upper band, the cohort bars a strip along
// the bottom, with a gap between so a bar never sits behind a dot.
const SCORE_BAND = 0.7;
const COHORT_BAND = 0.26;
// The strip is h-7 (28px) plus its label line and margin. Reserve the height:
// ChartCabinetStrip renders null until governments.json resolves, and this tile
// sits above everything else on the route.
const STRIP_MIN_H = 46;
// Below this the axis gutters (86px) leave no usable plot, and px() would start
// mapping points right-to-left. Nothing narrower is worth drawing.
const MIN_PLOT_W = 160;

export const MaturaTrendChart: FC<{
  national: MaturaYear[];
  lang: string;
}> = ({ national, lang }) => {
  const bg = lang === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const isSmall = useMediaQueryMatch("sm");
  const [setPlotEl, plotWidth] = useMeasuredWidth();
  const { data: governments } = useGovernments();
  const { tooltip, onMouseEnter, onMouseMove, onMouseLeave } = useTooltip({
    maxWidth: 240,
    maxHeight: 160,
  });

  const rows = useMemo(() => buildMaturaRows(national), [national]);

  // Which cabinet was in office on exam day — saves the reader from eyeballing
  // the dot against the strip below.
  const pmOn = useMemo(() => {
    const list = governments ?? [];
    return (date: string): string | null => {
      const g = list.find(
        (c) => c.startDate <= date && (c.endDate == null || date < c.endDate),
      );
      return g ? (bg ? g.pmBg : g.pmEn) : null;
    };
  }, [governments, bg]);

  if (rows.length < 2) return null;

  // Draw ONLY at a measured width — never at a guessed fallback. The card is a
  // grid item (min-width:auto), so an SVG wider than the column stretches the
  // track, which makes the host measure that inflated width, which keeps the
  // SVG wide: the guess latches instead of correcting. An empty host always
  // measures the true column width, so the first measurement is right.
  const W = plotWidth;
  const PAD = { l: 40, r: isSmall ? 14 : 46, t: 12, b: 26 };
  const plotH = H - PAD.t - PAD.b;
  const scoreH = plotH * SCORE_BAND;
  const cohortH = plotH * COHORT_BAND;
  const baseline = H - PAD.b;

  const t0 = rows[0].t - X_PAD;
  const t1 = rows[rows.length - 1].t + X_PAD;
  const [yLo, yHi] = scoreDomain(rows);
  const nPeak = Math.max(...rows.map((r) => r.examinees));
  // Guard the scale, not just the look: a register year that carried scores but
  // no counts would divide by zero and NaN every bar coordinate.
  const nMax = Math.max(1, cohortMax(rows));

  const px = (t: number) =>
    PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const py = (v: number) => PAD.t + scoreH - ((v - yLo) / (yHi - yLo)) * scoreH;
  const pyN = (n: number) => baseline - (n / nMax) * cohortH;
  const barW = Math.min(24, Math.max(6, (W - PAD.l - PAD.r) * 0.05));

  const fmtScore = (v: number, digits = 2) =>
    v.toLocaleString(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  // role="img" collapses the whole chart to this one string for a screen
  // reader, so the label has to carry the series itself — the year-by-year
  // figures used to sit in a text row under the sparkline this replaced.
  const ariaLabel =
    (bg
      ? "Национален успех на матурата по БЕЛ по години: "
      : "National matura average in Bulgarian by year: ") +
    rows.map((r) => `${r.year} — ${fmtScore(r.avg)}`).join("; ");

  const tipFor = (r: (typeof rows)[number]) => {
    const pm = pmOn(r.date);
    return (
      <span className="block">
        <span className="block font-medium">{fmtDate(r.date)}</span>
        <span className="block tabular-nums">
          {bg ? "среден успех" : "average"}: {fmtScore(r.avg)}
        </span>
        <span className="block tabular-nums">
          {r.examinees.toLocaleString(locale)}{" "}
          {bg ? "зрелостници" : "graduates"}
        </span>
        {pm ? (
          <span className="block">
            {bg ? "кабинет" : "cabinet"}: {pm}
          </span>
        ) : null}
      </span>
    );
  };

  return (
    <>
      {/* Height reserved so the measure-then-draw pass costs no layout shift. */}
      <div ref={setPlotEl} className="overflow-hidden" style={{ height: H }}>
        {W > MIN_PLOT_W && (
          <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={ariaLabel}
          >
            {/* score gridlines + labels */}
            {scoreTicks([yLo, yHi]).map((g) => (
              <g key={g}>
                <line
                  x1={PAD.l}
                  x2={W - PAD.r}
                  y1={py(g)}
                  y2={py(g)}
                  stroke="currentColor"
                  className="text-border"
                  strokeWidth={0.5}
                />
                <text
                  x={PAD.l - 6}
                  y={py(g) + 3}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px]"
                >
                  {fmtScore(g, 2)}
                </text>
              </g>
            ))}

            {/* cohort-size band, along the bottom */}
            {rows.map((r) => (
              <rect
                key={`n-${r.year}`}
                x={px(r.t) - barW / 2}
                y={pyN(r.examinees)}
                width={barW}
                height={baseline - pyN(r.examinees)}
                fill="hsl(var(--muted-foreground) / 0.16)"
              />
            ))}
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={baseline}
              y2={baseline}
              stroke="currentColor"
              className="text-border"
              strokeWidth={0.5}
            />
            {!isSmall && (
              <text
                x={W - PAD.r + 6}
                y={pyN(nPeak) + 4}
                className="fill-muted-foreground text-[10px]"
              >
                {nPeak.toLocaleString(locale, {
                  notation: "compact",
                  maximumFractionDigits: 0,
                })}
              </text>
            )}

            {/* the score line */}
            <polyline
              points={rows.map((r) => `${px(r.t)},${py(r.avg)}`).join(" ")}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {rows.map((r) => (
              <circle
                key={`d-${r.year}`}
                cx={px(r.t)}
                cy={py(r.avg)}
                r={3.5}
                fill="hsl(var(--primary))"
              />
            ))}

            {/* x labels + full-height hover targets */}
            {rows.map((r, i) => {
              const left = i === 0 ? PAD.l : (px(rows[i - 1].t) + px(r.t)) / 2;
              const right =
                i === rows.length - 1
                  ? W - PAD.r
                  : (px(r.t) + px(rows[i + 1].t)) / 2;
              return (
                <g key={`x-${r.year}`}>
                  <text
                    x={px(r.t)}
                    y={H - 8}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[11px]"
                  >
                    {r.year}
                  </text>
                  <rect
                    x={left}
                    y={PAD.t}
                    width={Math.max(1, right - left)}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={(e) =>
                      onMouseEnter(
                        { pageX: e.pageX, pageY: e.pageY },
                        tipFor(r),
                      )
                    }
                    onMouseMove={(e) =>
                      onMouseMove({ pageX: e.pageX, pageY: e.pageY })
                    }
                    onMouseLeave={onMouseLeave}
                  />
                </g>
              );
            })}
          </svg>
        )}
      </div>

      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
        style={{ paddingLeft: PAD.l }}
      >
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-0.5 w-3.5 rounded"
            style={{ backgroundColor: "hsl(var(--primary))" }}
          />
          {bg ? "среден успех" : "average score"}
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: "hsl(var(--muted-foreground) / 0.16)" }}
          />
          {bg ? "брой зрелостници" : "graduates"}
        </span>
      </div>

      <div className="pt-2" style={{ minHeight: STRIP_MIN_H }}>
        <div
          className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground"
          style={{ paddingLeft: PAD.l }}
        >
          {bg ? "Правителства" : "Governments"}
        </div>
        <ChartCabinetStrip
          fromDate={fromFractionalYear(t0)}
          toDate={fromFractionalYear(t1)}
          padLeft={PAD.l}
          padRight={PAD.r}
        />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground/70">
        {bg
          ? "Правителството е контекст, не обяснение — матурата е резултат от 12 години учене."
          : "The cabinet is context, not explanation — a matura score is twelve years of schooling."}
      </p>

      {/* OUTSIDE the svg — the shared tooltip positions with page coords. */}
      {tooltip}
    </>
  );
};
