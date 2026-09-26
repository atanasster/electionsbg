// The person page's charts (news-person-sentiment-v1 §6.1).
//
// ⚠️ NOTHING HERE ORDERS BY TONE. Outlets are listed by how much they covered
// the person, periods by date. A mean is drawn only with its interval and its
// n, and only where the build published one.

import { useId } from "react";
import type {
  PersonBasisSummary,
  PersonOutletRow,
  PersonPayload,
  PersonSeriesPoint,
  ToneBucket,
} from "../data";
import { formatDay, toneMeta } from "../labels";
import { useNewsLocale } from "../i18n";
import { BUCKET_EDGES } from "../sentimentScale";
import { BUCKETS, BUCKET_FILL, roleChanges } from "../personPage";

/** The display scale's half-range (five anchors: −2…+2). */
const EXTENT = 2;
const pct = (v: number) =>
  Math.min(100, Math.max(0, ((v / EXTENT + 1) / 2) * 100));

/** The five-bucket distribution: a stacked bar with a labelled count per colour. */
export const ToneBuckets = ({
  counts,
  total,
  compact = false,
}: {
  counts: Partial<Record<ToneBucket, number>>;
  total: number;
  compact?: boolean;
}) => {
  const { language, tr } = useNewsLocale();
  const segments = BUCKETS.map((b) => ({ b, n: counts[b] ?? 0 })).filter(
    (s) => s.n > 0,
  );
  if (!total || !segments.length)
    return (
      <p className="text-xs text-muted-foreground">
        {tr("Няма оценки.", "No assessments.")}
      </p>
    );
  return (
    <div data-testid="tone-buckets">
      <div
        className={`flex overflow-hidden rounded-full ${compact ? "h-1.5" : "h-2.5"}`}
        role="img"
        aria-label={segments
          .map((s) => `${toneMeta(s.b, language).label} ${s.n}`)
          .join(", ")}
      >
        {segments.map((s) => (
          <span
            key={s.b}
            className={`block h-full ${BUCKET_FILL[s.b]}`}
            style={{ width: `${(s.n / total) * 100}%` }}
          />
        ))}
      </div>
      {compact ? null : (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {segments.map((s) => (
            <li key={s.b}>
              <span
                aria-hidden
                className={`mr-1 inline-block size-2 rounded-sm align-middle ${BUCKET_FILL[s.b]}`}
              />
              {toneMeta(s.b, language).label} {s.n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** Where the mean sits, with its 95% interval, on the −2…+2 scale. */
export const PersonPosition = ({ s }: { s: PersonBasisSummary }) => {
  const { language, tr } = useNewsLocale();
  if (typeof s.mean !== "number" || !s.mean_bucket)
    return (
      <p className="text-sm text-muted-foreground">
        {tr("Няма средна стойност.", "No mean.")}
      </p>
    );
  const meta = toneMeta(s.mean_bucket, language);
  const hasCi = typeof s.ci_low === "number" && typeof s.ci_high === "number";
  return (
    <div data-testid="person-position">
      <p className={`font-title text-lg ${meta.className}`}>{meta.label}</p>
      <div
        role="img"
        aria-label={tr(
          `Средно ${s.mean.toFixed(2)} по скала от −2 до +2${hasCi ? `, 95% интервал ${s.ci_low!.toFixed(2)} до ${s.ci_high!.toFixed(2)}` : ""}`,
          `Mean ${s.mean.toFixed(2)} on a −2 to +2 scale${hasCi ? `, 95% interval ${s.ci_low!.toFixed(2)} to ${s.ci_high!.toFixed(2)}` : ""}`,
        )}
        className="relative mt-2 h-3"
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
        {BUCKET_EDGES.map((edge) => (
          <span
            key={edge}
            aria-hidden
            className="absolute top-0 h-3 w-px bg-border"
            style={{ left: `${pct(edge * EXTENT)}%` }}
          />
        ))}
        {hasCi ? (
          <span
            aria-hidden
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/25"
            style={{
              left: `${pct(s.ci_low!)}%`,
              width: `${pct(s.ci_high!) - pct(s.ci_low!)}%`,
            }}
          />
        ) : null}
        <span
          aria-hidden
          className="absolute top-0 h-3 w-1.5 -translate-x-1/2 rounded-sm bg-foreground"
          style={{ left: `${pct(s.mean)}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{toneMeta("strongly_unfavorable", language).label}</span>
        <span>{toneMeta("strongly_favorable", language).label}</span>
      </div>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
        {s.mean.toFixed(2)}
        {hasCi
          ? tr(
              ` (95%: ${s.ci_low!.toFixed(2)} … ${s.ci_high!.toFixed(2)})`,
              ` (95%: ${s.ci_low!.toFixed(2)} … ${s.ci_high!.toFixed(2)})`,
            )
          : ""}
      </p>
    </div>
  );
};

/**
 * Diagonal stripes over an under-covered column. An SVG pattern, not a CSS
 * gradient: the app forbids `background-image` outright so no photograph can
 * reach a page uncredited (`imageCredit.test.ts`).
 */
const Hatch = () => {
  // `useId` returns punctuation (`:r1:` / `«r1»`) that a `url(#…)`
  // reference does not reliably survive; the pattern id must be plain.
  const id = `hatch${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg aria-hidden className="absolute inset-0 size-full">
      <defs>
        <pattern
          id={id}
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="5"
            stroke="hsl(var(--background))"
            strokeWidth="2"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
};

const COLUMN_PX = 44;
const CHART_PX = 96;

/**
 * Coverage over time. ⚠️ A period below the coverage floor is HATCHED and has
 * no mean marker: the corpus did not score enough of that period's articles
 * for the chart to speak for it. Role changes are marked where they fall.
 */
export const PersonSeries = ({
  p,
  subject,
}: {
  p: PersonPayload;
  subject: string;
}) => {
  const { isEnglish, language, tr } = useNewsLocale();
  const points = p.series.points;
  if (points.length < 2) return null;
  const tallest = Math.max(...points.map((pt) => pt.n), 1);
  const changes = roleChanges(
    p.roles,
    points.map((pt) => pt.period),
    p.series.granularity,
    p.role_labels,
    isEnglish,
  );
  const changeAt = new Map<string, string[]>();
  for (const c of changes)
    changeAt.set(c.period, [...(changeAt.get(c.period) ?? []), c.text]);
  const anyHatched = points.some((pt) => pt.below_floor);
  const floor = Math.round(p.series.coverage_floor * 100);
  return (
    <section aria-labelledby="person-series" data-testid="person-series">
      <h2 id="person-series" className="text-sm font-medium">
        {tr(
          `Отразяване на ${subject} във времето`,
          `Coverage of ${subject} over time`,
        )}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {tr(
          "Височина = брой (издание, история); цвят = как са го представили; числото под колоната = средната стойност (при посочване — ±1 стандартна грешка).",
          "Height = number of (outlet, story) units; colour = how they framed them; the number under a column = its mean (hover for ±1 standard error).",
        )}
      </p>
      <div className="mt-2 overflow-x-auto">
        <ol
          className="flex items-end gap-1"
          style={{ minWidth: points.length * (COLUMN_PX + 4) }}
        >
          {points.map((pt: PersonSeriesPoint) => {
            const h = Math.max(6, (pt.n / tallest) * CHART_PX);
            const marks = changeAt.get(pt.period);
            return (
              <li
                key={pt.period}
                className="flex flex-col items-center"
                style={{ width: COLUMN_PX }}
                aria-label={`${formatDay(pt.period, language)}: ${pt.n}${pt.below_floor ? tr(" · непълно покритие", " · incomplete coverage") : ""}`}
              >
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {pt.n}
                </span>
                <div
                  className={`relative flex w-full flex-col-reverse overflow-hidden rounded-sm ${pt.below_floor ? "opacity-40" : ""}`}
                  style={{ height: h }}
                  data-testid={
                    pt.below_floor ? "series-hatched" : "series-column"
                  }
                >
                  {BUCKETS.map((b) =>
                    pt.counts[b] ? (
                      <span
                        key={b}
                        className={BUCKET_FILL[b]}
                        style={{ height: `${(pt.counts[b] / pt.n) * 100}%` }}
                      />
                    ) : null,
                  )}
                  {pt.below_floor ? <Hatch /> : null}
                </div>
                {!pt.below_floor && typeof pt.mean === "number" ? (
                  <span
                    className="mt-1 text-[10px] tabular-nums text-foreground"
                    title={
                      typeof pt.se === "number"
                        ? `±${pt.se.toFixed(2)}`
                        : undefined
                    }
                  >
                    {pt.mean.toFixed(1)}
                  </span>
                ) : (
                  <span className="mt-1 text-[10px] text-muted-foreground">
                    —
                  </span>
                )}
                <span className="mt-0.5 text-[10px] text-muted-foreground">
                  {formatDay(pt.period, language)}
                </span>
                {marks ? (
                  <span
                    className="mt-0.5 text-[10px] font-medium text-primary"
                    title={marks.join("; ")}
                    data-testid="series-role-change"
                  >
                    ▲
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
      {changes.length ? (
        <ul className="mt-1 text-xs text-muted-foreground">
          {changes.map((c) => (
            <li key={`${c.period}-${c.text}`}>
              ▲ {formatDay(c.period, language)} — {c.text}
            </li>
          ))}
        </ul>
      ) : null}
      {anyHatched ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {tr(
            `Избледнелите периоди са под прага от ${floor}% оценени статии в корпуса — там не показваме средна стойност.`,
            `Faded periods fall below ${floor}% of the corpus's articles scored — no mean is shown there.`,
          )}
        </p>
      ) : null}
      {p.series.undated ? (
        <p className="text-xs text-muted-foreground">
          {tr(
            `${p.series.undated} без дата — в общия брой, не в графиката.`,
            `${p.series.undated} undated — in the totals, not the chart.`,
          )}
        </p>
      ) : null}
    </section>
  );
};

/** One row per outlet, ordered by how much it covered the person. */
export const PersonOutlets = ({
  rows,
  selected,
  onSelect,
}: {
  rows: PersonOutletRow[];
  selected?: string | null;
  onSelect?: (domain: string | null) => void;
}) => {
  const { language, tr } = useNewsLocale();
  if (!rows.length) return null;
  return (
    <section aria-labelledby="person-outlets" data-testid="person-outlets">
      <h2 id="person-outlets" className="text-sm font-medium">
        {tr("По издания", "By outlet")}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {tr(
          "Подредени по обем на отразяването, не по тон. Средна стойност има само при поне 5 (издание, история); ± е половината от 95% интервал.",
          "Ordered by volume of coverage, not by tone. A mean is shown only from 5 (outlet, story) units; ± is half the 95% interval.",
        )}
      </p>
      <table className="mt-2 w-full text-sm">
        <thead className="sr-only">
          <tr>
            <th>{tr("Издание", "Outlet")}</th>
            <th>n</th>
            <th>{tr("Разпределение", "Distribution")}</th>
            <th>{tr("Средно", "Mean")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr
              key={o.domain}
              className={`border-t ${selected === o.domain ? "bg-muted/60" : ""}`}
            >
              <td className="py-1.5 pr-2">
                {onSelect ? (
                  <button
                    type="button"
                    className="text-left underline-offset-4 hover:underline"
                    aria-pressed={selected === o.domain}
                    onClick={() =>
                      onSelect(selected === o.domain ? null : o.domain)
                    }
                  >
                    {o.domain}
                  </button>
                ) : (
                  o.domain
                )}
              </td>
              <td className="w-10 py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                {o.n}
              </td>
              <td className="w-1/3 py-1.5 pr-2">
                <ToneBuckets counts={o.counts} total={o.n} compact />
              </td>
              <td className="py-1.5 text-right text-xs tabular-nums">
                {o.mean_withheld || typeof o.mean !== "number" ? (
                  <span className="text-muted-foreground">
                    {tr("под 5", "under 5")}
                  </span>
                ) : (
                  <span
                    className={toneMeta(o.mean_bucket!, language).className}
                  >
                    {o.mean.toFixed(2)}
                    {typeof o.ci_low === "number" &&
                    typeof o.ci_high === "number"
                      ? ` ±${((o.ci_high - o.ci_low) / 2).toFixed(2)}`
                      : ""}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};
