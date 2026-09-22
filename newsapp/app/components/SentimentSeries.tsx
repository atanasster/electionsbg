// One subject's coverage over time: how much, framed how, and — once the
// ordinal pass is live for those articles — where on the scale.
//
// ⚠️ COLUMNS, NOT A LINE, AND THAT IS THE HONEST FORM FOR THIS DATA. The
// producer omits an empty period rather than emitting a zero (a zero plots as
// „the press said nothing favourable that week" where the truth is „nothing
// was published"), so a line would have to connect across a gap it cannot see
// — asserting continuity through days nobody covered. Columns imply nothing
// between them. It is also why there is no sparkline: a shape with no axis and
// no counts is exactly the reading this data cannot support.
//
// ⚠️ EVERY POINT CARRIES ITS OWN `n`, ON BOTH ROWS. §6.3 requires it in those
// words. The two rows have DIFFERENT denominators — `rows` is the coverage in
// that period, `value_scored` the part of it placed on the scale — so printing
// only the first above a marker driven by the second states the wrong number
// in the right place.
//
// ⚠️ CONFIDENCE IS A BAND, NEVER FOLDED INTO THE VALUE. A confident answer is
// not a strong one — 0.98 on „neutral" is a confident zero — so the marker
// shows the mean and the whisker shows ±1 standard error beside it.
//
// ⚠️ ONE SCROLLER, NOT TWO. The rows are aligned by construction and would
// desync the moment the chart overflows if each scrolled on its own.

import type { SentimentSeries as SeriesData, SeriesPoint, Tone } from "../data";
import { useNewsLocale } from "../i18n";
import { formatDay, toneMeta } from "../labels";
import { markerTop, whiskerFor } from "../sentimentGeometry";

const ORDER: Tone[] = ["favorable", "neutral", "unfavorable", "mixed"];

const COLUMN_PX = 56;
const POSITION_PX = 44;

const FILL: Record<Tone, string> = {
  favorable: "bg-positive",
  neutral: "bg-muted-foreground",
  unfavorable: "bg-negative",
  mixed: "bg-foreground",
};

const scoredPoints = (points: SeriesPoint[]) =>
  points.filter((p) => p.value_scored > 0 && typeof p.value_mean === "number");

export const SentimentSeries = ({
  series,
  subject,
}: {
  series: SeriesData;
  subject: string;
}) => {
  const { language, tr } = useNewsLocale();
  const points = series.points ?? [];
  if (points.length < 2) return null;

  const tallest = Math.max(...points.map((p) => p.rows), 1);
  const scored = scoredPoints(points);
  const anyClipped = scored.some((p) => {
    if (typeof p.value_se !== "number" || typeof p.value_mean !== "number")
      return false;
    const w = whiskerFor(p.value_mean, p.value_se);
    return w.clippedHigh || w.clippedLow;
  });
  const granularity =
    series.granularity === "day"
      ? tr("по ден", "by day")
      : series.granularity === "week"
        ? tr("по седмица", "by week")
        : tr("по месец", "by month");

  return (
    <section className="mt-4 border-t pt-3" aria-labelledby="coverage-series">
      <h2 id="coverage-series" className="text-sm font-medium">
        {tr(
          `Отразяване на ${subject} във времето`,
          `Coverage of ${subject} over time`,
        )}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {tr(
          `Всяка колона е един период (${granularity}) с броя материали в него. Периодите без материали липсват, а не са нула.`,
          `Each column is one period (${granularity}) with the number of articles in it. Periods with no articles are absent, not zero.`,
        )}
      </p>

      {/* The colours carry meaning, so they get a legend. */}
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {ORDER.map((tone) => (
          <li key={tone}>
            <span
              aria-hidden
              className={`mr-1 inline-block size-2 rounded-sm align-middle ${FILL[tone]}`}
            />
            {toneMeta(tone, language)?.label ?? tone}
          </li>
        ))}
      </ul>

      <div className="mt-3 overflow-x-auto pb-1">
        <ol
          className="flex items-end gap-1"
          aria-label={tr("Материали по период", "Articles per period")}
        >
          {points.map((point) => (
            <li
              key={point.period}
              className="flex min-w-10 flex-1 flex-col items-center gap-1"
            >
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {point.rows}
              </span>
              <span
                className="flex w-full flex-col-reverse overflow-hidden rounded-sm"
                style={{
                  height: `${Math.max(6, (point.rows / tallest) * COLUMN_PX)}px`,
                }}
                role="presentation"
              >
                {ORDER.filter((tone) => (point.counts[tone] ?? 0) > 0).map(
                  (tone) => (
                    <span
                      key={tone}
                      className={`block w-full ${FILL[tone]}`}
                      style={{
                        height: `${((point.counts[tone] ?? 0) / point.rows) * 100}%`,
                      }}
                    />
                  ),
                )}
              </span>
              {/* ⚠️ `formatDay`, not `formatDate`: `period` is a GROUPING KEY
                  the producer cut in Europe/Sofia, and the browser-local
                  formatter reads "2026-09-21" as UTC midnight — shifting every
                  label a day for any reader west of UTC. */}
              <span className="max-w-full truncate text-[10px] text-muted-foreground">
                {formatDay(point.period, language)}
              </span>
            </li>
          ))}
        </ol>

        {scored.length >= 2 ? (
          <ol
            className="mt-3 flex items-stretch gap-1"
            aria-label={tr("Положение по скалата", "Position on the scale")}
          >
            {points.map((point) => {
              const mean = point.value_mean;
              const has = point.value_scored > 0 && typeof mean === "number";
              const se = point.value_se;
              const whisker =
                has && typeof se === "number"
                  ? whiskerFor(mean as number, se)
                  : null;
              return (
                <li
                  key={point.period}
                  className="relative flex min-w-10 flex-1 flex-col items-center"
                >
                  <span
                    className="relative w-full"
                    style={{ height: `${POSITION_PX}px` }}
                  >
                    <span
                      aria-hidden
                      className="absolute inset-x-0 top-1/2 h-px bg-border"
                    />
                    {has ? (
                      <>
                        {whisker ? (
                          <span
                            aria-hidden
                            className={`absolute left-1/2 w-px -translate-x-1/2 ${
                              whisker.clippedHigh || whisker.clippedLow
                                ? "bg-muted-foreground/30"
                                : "bg-muted-foreground/60"
                            }`}
                            style={{
                              top: `${whisker.top}%`,
                              bottom: `${whisker.bottom}%`,
                            }}
                          />
                        ) : null}
                        <span
                          aria-hidden
                          className="absolute left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
                          style={{ top: `${markerTop(mean as number)}%` }}
                        />
                      </>
                    ) : null}
                  </span>
                  {/* ⚠️ The position row's OWN denominator. `rows` above is a
                      different, larger number, and printing only that would
                      make a mean over 2 look like a mean over 40. */}
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {has
                      ? tr(
                          `${(mean as number).toFixed(1)} · ${point.value_scored}`,
                          `${(mean as number).toFixed(1)} · ${point.value_scored}`,
                        )
                      : "—"}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>

      {scored.length >= 2 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {tr(
            "Долният ред е положението по скалата (от −2 неблагоприятно до +2 благоприятно), със стандартна грешка; под всяка точка са средното и броят оценени материали. Точка без чертичка е един материал — няма разсейване за отчитане.",
            "The lower row is the position on the scale (−2 unfavourable to +2 favourable) with its standard error; under each point are the mean and the number of scored articles. A point with no whisker is a single article — there is no spread to report.",
          )}
          {anyClipped
            ? tr(
                " Бледа чертичка излиза извън скалата и е отрязана.",
                " A faint whisker runs past the scale and is cut off.",
              )
            : null}
        </p>
      ) : null}

      {series.undated ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {tr(
            `${series.undated} без дата — не са в нито един период.`,
            `${series.undated} undated — in no period.`,
          )}
        </p>
      ) : null}
    </section>
  );
};
