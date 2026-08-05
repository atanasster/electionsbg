// "Матура в областта" — the education headline on a Governance place node.
//
// Three zones, in the order a reader needs them: the place's own matura average
// against the national one, the spread inside the place (which is the finding a
// place page can make that the national table cannot — the gap between Sofia's
// best and worst school is wider than the gap between any two oblasts), and the
// по-общини table, which is the region node's country → region → município
// crawl path as much as it is a tile.
//
// Reads the precomputed place blob (a few KB). Self-hides without one — a
// diaspora МИР, a place with no matura school, or a database where the loader
// has not run yet all look the same to a reader, and all three mean "we have
// nothing to say here".

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GraduationCap } from "lucide-react";
import { MIN_RANK_COHORT } from "@/data/schools/useSchoolDirectory";
import { StatCard } from "./StatCard";
import { fmtCount, fmtScore, fmtSigned } from "./educationPlaceFormat";
import type {
  EducationPlace,
  EducationPlaceSchool,
} from "@/data/schools/useEducationPlace";

type Props = {
  place: EducationPlace;
  /** The blob is another place's (a Sofia МИР, or Пловдив-град) — say so. */
  aliasNote?: string | null;
};

/** Under half a hundredth the difference rounds to 0,00 on screen, so calling
 *  it a direction would colour a tie green. */
const TIE_BAND = 0.005;

/** One school row, used by both the best and the worst list. */
const SchoolRow: FC<{ s: EducationPlaceSchool; lang: string }> = ({
  s,
  lang,
}) => (
  <li className="flex items-baseline gap-2 text-sm">
    <Link
      to={`/school/${s.id}`}
      className="min-w-0 flex-1 truncate hover:text-primary"
    >
      {s.name}
      <span className="ml-1 text-xs text-muted-foreground">
        {s.obshtinaName}
      </span>
    </Link>
    <span className="shrink-0 tabular-nums font-semibold">
      {fmtScore(s.score, lang)}
    </span>
  </li>
);

export const EducationPlaceTile: FC<Props> = ({ place, aliasNote }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const delta =
    place.nationalAvg != null ? place.avg - place.nationalAvg : null;
  // The change since the first year on record. Measured against the HEADLINE
  // average, not the series' own last point — the /education convention, so
  // the change and the number beside it always reconcile on screen.
  const first = place.series.length >= 2 ? place.series[0] : null;
  const trend = first ? place.avg - first.avg : null;
  // Sofia city is one município, so its "по общини" table would be a single row
  // restating the headline. A table needs a comparison to be a table.
  const showMuniTable = place.byObshtina.length > 1;

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4" />
          <span>{t("education_place_title")}</span>
        </div>
      }
      hint={t("education_place_hint")}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-3xl font-bold tabular-nums">
          {fmtScore(place.avg, lang)}
        </span>
        {place.latestYear != null && (
          <span className="text-sm text-muted-foreground">
            {place.latestYear}
          </span>
        )}
        {/* An exact tie is not a direction: "0,00 спрямо страната" in green
            reads as a (tiny) win. Say it plainly and drop the colour. */}
        {delta != null &&
          (Math.abs(delta) < TIE_BAND ? (
            <span className="text-sm text-muted-foreground">
              {t("education_place_same_as_national")}
            </span>
          ) : (
            <span
              className={`text-sm tabular-nums ${
                delta > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {fmtSigned(delta, lang)} {t("education_place_vs_national")}
            </span>
          ))}
      </div>

      {trend != null && first && (
        <div className="mt-1 text-xs text-muted-foreground">
          {t("education_place_trend", {
            from: first.year,
            to: place.latestYear,
            delta: fmtSigned(trend, lang),
            first: fmtScore(first.avg, lang),
          })}
        </div>
      )}

      <div className="mt-1 text-xs text-muted-foreground">
        {place.rank != null &&
          place.rankOf != null &&
          `${t("education_place_rank", {
            rank: place.rank,
            of: place.rankOf,
          })} · `}
        {/* `count` selects the plural form, `formatted` carries the grouped
            number — "1 училища" is what a single-school município got before. */}
        {t("education_place_schools", {
          count: place.schools,
          formatted: fmtCount(place.schools, lang),
        })}{" "}
        ·{" "}
        {t("education_place_graduates", {
          count: place.examinees,
          formatted: fmtCount(place.examinees, lang),
        })}
      </div>

      {place.shareInFailingSchools != null &&
        place.shareInFailingSchools > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">
            {t("education_place_failing", {
              pct: `${fmtScore(place.shareInFailingSchools, lang, 1)}%`,
            })}
          </div>
        )}

      {(place.top.length > 0 || place.bottom.length > 0) && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {place.top.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                {t("education_place_best")}
              </div>
              <ol className="space-y-1">
                {place.top.map((s) => (
                  <SchoolRow key={s.id} s={s} lang={lang} />
                ))}
              </ol>
            </div>
          )}
          {place.bottom.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                {t("education_place_worst")}
              </div>
              <ol className="space-y-1">
                {place.bottom.map((s) => (
                  <SchoolRow key={s.id} s={s} lang={lang} />
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {showMuniTable && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            {t("education_place_by_muni")}
          </div>
          {/* The full list, not a top-N: these are the region → município
              links the node exists to provide. Scrolls past ~8 rows rather
              than towering over the tile beside it; tabIndex makes the box
              keyboard-scrollable, since it can hold 19 rows, and the label is
              what a screen reader announces when focus lands in it. */}
          <div
            className="max-h-64 overflow-y-auto"
            tabIndex={0}
            role="group"
            aria-label={t("education_place_by_muni")}
          >
            <table className="w-full text-sm">
              {/* Three of these four columns are bare numbers; without headers
                  a reader has to guess which is the average, which the change
                  (and against what) and which the cohort. Sticky, because up to
                  19 rows scroll under it. Padding mirrors the body cells —
                  without it the last two butt together ("от 2022Зрелостници"). */}
              <thead className="sticky top-0 bg-card text-xs font-normal text-muted-foreground">
                <tr>
                  <th scope="col" className="pr-2 text-left font-normal">
                    {t("education_place_col_muni")}
                  </th>
                  <th scope="col" className="pr-2 text-right font-normal">
                    {place.latestYear ?? t("education_place_col_avg")}
                  </th>
                  <th scope="col" className="pr-2 text-right font-normal">
                    {first
                      ? t("education_place_col_since", { year: first.year })
                      : t("education_place_col_change")}
                  </th>
                  <th scope="col" className="pr-1 text-right font-normal">
                    {t("education_place_col_examinees")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {place.byObshtina.map((m) => (
                  <tr key={m.obshtina} className="border-t first:border-t-0">
                    <td className="py-1 pr-2">
                      <Link
                        to={`/governance/${m.obshtina}`}
                        className="hover:text-primary"
                      >
                        {m.name}
                      </Link>
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums font-medium">
                      {fmtScore(m.avg, lang)}
                    </td>
                    <td className="w-14 py-1 pr-2 text-right text-xs tabular-nums text-muted-foreground">
                      {m.delta != null ? fmtSigned(m.delta, lang) : "—"}
                    </td>
                    {/* pr-1 keeps the last column clear of the scrollbar. */}
                    <td className="w-16 py-1 pr-1 text-right text-xs tabular-nums text-muted-foreground">
                      {fmtCount(m.examinees, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-2 text-[10px] text-muted-foreground/80">
        {aliasNote ? `${aliasNote} ` : ""}
        {t("education_place_min_cohort", { min: MIN_RANK_COHORT })}{" "}
        {t("education_place_method")}{" "}
        <Link to="/education" className="text-primary hover:underline">
          {t("education_place_all_schools")}
        </Link>
      </p>
    </StatCard>
  );
};
