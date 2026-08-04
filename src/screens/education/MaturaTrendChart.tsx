// The ДЗИ БЕЛ trend chart, shared by /education (the country, with the
// governments strip under it) and /school/:id (one school against the country,
// without it). Two things the sparkline it replaced could not do:
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
// caption says so, and the strip is off entirely on a single school, where the
// attribution would be nonsense two levels down.
//
// On a school the benchmark line is what makes the chart honest: 92% of schools
// rose in 2024, so a school's own line says nothing without the country's
// beside it.

import { FC, useMemo } from "react";
import { useGovernments } from "@/data/governments/useGovernments";
import { ChartCabinetStrip } from "@/screens/components/governments/ChartCabinetStrip";
import { useMeasuredWidth } from "@/ux/useMeasuredWidth";
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
// Room reserved INSIDE the cohort band for the per-year count above each bar.
// Kept out of the bar heights rather than taken from the gap: the tallest bar
// would otherwise push its own label into the score band, on top of the line.
const COHORT_LABEL_H = 12;
// SVG exposes no text metrics, so the collision guard estimates instead: the
// 10px tabular digits these labels use run ~5.6px per character.
const LABEL_CH_W = 5.6;
// The strip is h-7 (28px) plus its label line and margin. Reserve the height:
// ChartCabinetStrip renders null until governments.json resolves, and this tile
// sits above everything else on the route.
const STRIP_MIN_H = 46;
// Below this the axis gutters (86px) leave no usable plot, and px() would start
// mapping points right-to-left. Nothing narrower is worth drawing.
const MIN_PLOT_W = 160;

export const MaturaTrendChart: FC<{
  /** The subject of the chart: nationally the country, on /school/:id the school. */
  national: MaturaYear[];
  lang: string;
  /** Faint dashed benchmark drawn behind the subject — the national series on a
   *  school page. Without it a school's own rise is unreadable: 92% of schools
   *  rose in 2024, so "we improved" says nothing on its own. */
  reference?: MaturaYear[];
  /** Label for the reference line in the legend and tooltip. */
  referenceLabel?: string;
  /** Cohorts below this render as hollow dots — the year is too small to trust
   *  (12% of school-years are under 10 examinees, where a 0.4 swing is noise). */
  provisionalBelow?: number;
  /** The governments strip only belongs under the national series; a cabinet
   *  band beside one school's line is attribution nonsense two levels down. */
  showCabinet?: boolean;
  /** Opening of the screen-reader label, before the year-by-year figures. */
  ariaTitle?: string;
}> = ({
  national,
  lang,
  reference,
  referenceLabel,
  provisionalBelow,
  showCabinet = true,
  ariaTitle,
}) => {
  const bg = lang === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const [setPlotEl, plotWidth] = useMeasuredWidth();
  const { data: governments } = useGovernments();
  const { tooltip, onMouseEnter, onMouseMove, onMouseLeave } = useTooltip({
    maxWidth: 240,
    maxHeight: 160,
  });

  const rows = useMemo(() => buildMaturaRows(national), [national]);
  const refRows = useMemo(
    () => (reference ? buildMaturaRows(reference) : []),
    [reference],
  );

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
  // The right gutter used to be 46 on wide screens purely to park the single
  // peak-cohort number outside the plot. The counts now sit on their own bars,
  // so the plot gets that width back.
  const PAD = { l: 40, r: 14, t: 12, b: 26 };
  const plotH = H - PAD.t - PAD.b;
  const scoreH = plotH * SCORE_BAND;
  const cohortH = plotH * COHORT_BAND;
  const baseline = H - PAD.b;

  // The window is the SUBJECT's span — a school with three years gets a
  // three-year chart, with the benchmark clipped to it rather than the chart
  // stretched to the country's five.
  const t0 = rows[0].t - X_PAD;
  const t1 = rows[rows.length - 1].t + X_PAD;
  const refInWindow = refRows.filter((r) => r.t >= t0 && r.t <= t1);
  // Both series share one scale, so a school at 2.4 against a national 4.3 has
  // to widen the band or the benchmark would sit off the plot.
  const [yLo, yHi] = scoreDomain([...rows, ...refInWindow]);
  const nPeak = Math.max(...rows.map((r) => r.examinees));
  // Guard the scale, not just the look: a register year that carried scores but
  // no counts would divide by zero and NaN every bar coordinate.
  const nMax = Math.max(1, cohortMax(rows));

  const px = (t: number) =>
    PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const py = (v: number) => PAD.t + scoreH - ((v - yLo) / (yHi - yLo)) * scoreH;
  const barsH = Math.max(1, cohortH - COHORT_LABEL_H);
  const pyN = (n: number) => baseline - (n / nMax) * barsH;
  const barW = Math.min(24, Math.max(6, (W - PAD.l - PAD.r) * 0.05));

  // Cohort size, printed above its own bar. Compact keeps the national series
  // ("49 хил.") from being three times the width of a school's ("12").
  const cohortLabel = (n: number) =>
    n.toLocaleString(locale, { notation: "compact", maximumFractionDigits: 0 });
  // The x axis is linear in TIME, so consecutive points are NOT evenly spaced —
  // the national series runs 2016, 2017, then a five-year hole to 2022. Where
  // the tightest pair cannot fit its two labels side by side, drop the labels
  // entirely rather than overprint them; the exact count is in the tooltip
  // either way, and a smudge of overlapping digits reads as a rendering bug.
  const cohortLabelW = Math.max(
    ...rows.map((r) => cohortLabel(r.examinees).length * LABEL_CH_W),
  );
  const minPointGap = Math.min(
    ...rows.slice(1).map((r, i) => px(r.t) - px(rows[i].t)),
  );
  const showCohortLabels = nPeak > 0 && minPointGap >= cohortLabelW + 6;
  // The first and last bars sit within X_PAD (0.1yr) of the plot edge, so a
  // centred label on them can overhang the SVG and get clipped.
  const clampLabelX = (x: number, text: string) => {
    const half = (text.length * LABEL_CH_W) / 2;
    return Math.min(Math.max(x, half + 1), W - half - 1);
  };

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
    (ariaTitle ??
      (bg
        ? "Национален успех на матурата по БЕЛ по години"
        : "National matura average in Bulgarian by year")) +
    ": " +
    rows.map((r) => `${r.year} — ${fmtScore(r.avg)}`).join("; ");

  const refByYear = new Map(refInWindow.map((r) => [r.year, r.avg]));
  // Only meaningful once cohorts are actually known: on a payload without them
  // every point would read as "too small to trust".
  const marksProvisional = provisionalBelow != null && nPeak > 0;
  const hasProvisional =
    marksProvisional && rows.some((r) => r.examinees < provisionalBelow);

  const tipFor = (r: (typeof rows)[number]) => {
    const pm = pmOn(r.date);
    const ref = refByYear.get(r.year);
    return (
      <span className="block">
        <span className="block font-medium">{fmtDate(r.date)}</span>
        <span className="block tabular-nums">
          {bg ? "среден успех" : "average"}: {fmtScore(r.avg)}
        </span>
        {ref != null && (
          <span className="block tabular-nums text-muted-foreground">
            {referenceLabel ?? (bg ? "страната" : "the country")}:{" "}
            {fmtScore(ref)} ({r.avg - ref >= 0 ? "+" : ""}
            {fmtScore(r.avg - ref)})
          </span>
        )}
        <span className="block tabular-nums">
          {r.examinees.toLocaleString(locale)}{" "}
          {bg ? "зрелостници" : "graduates"}
          {marksProvisional && r.examinees < provisionalBelow
            ? bg
              ? " · малък випуск"
              : " · small cohort"
            : ""}
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

            {/* cohort-size band, along the bottom. Skipped when no year carries
                a count — a payload built before series counts existed would
                otherwise draw a row of zero-height bars under a "0" label. */}
            {nPeak > 0 &&
              rows.map((r) => (
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
            {/* the count for EVERY year, on its own bar. A single number parked
                in the right gutter at the peak's height read as a label for the
                LAST year rather than as the scale's top — on Ружинци it printed
                "13" (2022's cohort) beside a 2026 bar of 12. */}
            {showCohortLabels &&
              rows.map((r) => {
                const text = cohortLabel(r.examinees);
                return (
                  <text
                    key={`nl-${r.year}`}
                    x={clampLabelX(px(r.t), text)}
                    y={pyN(r.examinees) - 3}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[10px] tabular-nums"
                  >
                    {text}
                  </text>
                );
              })}

            {/* the benchmark, drawn first so the subject sits on top of it */}
            {refInWindow.length >= 2 && (
              <polyline
                points={refInWindow
                  .map((r) => `${px(r.t)},${py(r.avg)}`)
                  .join(" ")}
                fill="none"
                stroke="currentColor"
                className="text-muted-foreground"
                strokeOpacity={0.55}
                strokeWidth={1.5}
                strokeDasharray="5 3"
                strokeLinejoin="round"
              />
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
            {rows.map((r) => {
              // Hollow = too few examinees to read the point as a result.
              const provisional =
                marksProvisional && r.examinees < provisionalBelow;
              return (
                <circle
                  key={`d-${r.year}`}
                  cx={px(r.t)}
                  cy={py(r.avg)}
                  r={3.5}
                  fill={
                    provisional ? "hsl(var(--card))" : "hsl(var(--primary))"
                  }
                  stroke={provisional ? "hsl(var(--primary))" : undefined}
                  strokeWidth={provisional ? 1.5 : undefined}
                />
              );
            })}

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
        {refInWindow.length >= 2 && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0 w-3.5 border-t border-dashed border-muted-foreground" />
            {referenceLabel ?? (bg ? "страната" : "the country")}
          </span>
        )}
        {nPeak > 0 && (
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: "hsl(var(--muted-foreground) / 0.16)" }}
            />
            {bg ? "брой зрелостници" : "graduates"}
          </span>
        )}
        {hasProvisional && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-primary bg-card" />
            {bg
              ? `под ${provisionalBelow} зрелостници`
              : `under ${provisionalBelow} graduates`}
          </span>
        )}
      </div>

      {showCabinet && (
        <>
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
        </>
      )}

      {/* OUTSIDE the svg — the shared tooltip positions with page coords. */}
      {tooltip}
    </>
  );
};
