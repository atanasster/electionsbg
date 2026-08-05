// "Над очакваното" — the context-adjusted cut of a place's schools.
//
// A raw matura average mostly measures a community's income and parental
// education, so a league table of it tells a reader what they already knew. The
// residual against the national SES regression asks the different question: does
// this school do better than schools working in the same conditions? That is
// the number nobody else publishes, and the reason this tile exists beside the
// headline rather than inside it.
//
// Three rules the tile must not break. It renders the residual the LOADER
// computed against the NATIONAL fit — re-fitting inside an oblast (20-142
// schools) would be noise. The value-added (7→12 НВО) line always carries its
// coverage, because only ~50-66% of schools have an НВО prior and an unlabelled
// average would imply a completeness we do not have. And it says NOTHING rather
// than something reassuring when there is no residual to speak from: 28 of 243
// município blobs have no rankable school at all, and "performs about as its
// context predicts" is a finding, not an empty state.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { MIN_RANK_COHORT } from "@/data/schools/useSchoolDirectory";
import { StatCard } from "./StatCard";
import { fmtScore, fmtSigned } from "./educationPlaceFormat";
import type { EducationPlace } from "@/data/schools/useEducationPlace";

/** Below this many schools with an НВО prior, the value-added average is a
 *  handful of schools wearing a place-wide label — say nothing instead. */
const VA_MIN_COVERED = 5;
/** Under a twentieth of a grade point is rounding, not a direction. */
const FLAT_BAND = 0.05;

type Props = {
  place: EducationPlace;
};

export const EducationExpectedTile: FC<Props> = ({ place }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const mean = place.meanResidual;
  const showVa =
    place.va.covered >= VA_MIN_COVERED && place.va.meanResidual != null;

  // Nothing measured here — no rankable school carries a residual. Self-hide
  // rather than let an absence of data read as a verdict of "as expected".
  if (mean == null && place.above.length === 0 && !showVa) return null;

  const verdict =
    mean == null
      ? null
      : Math.abs(mean) < FLAT_BAND
        ? t("education_expected_verdict_flat")
        : t(
            mean > 0
              ? "education_expected_verdict_above"
              : "education_expected_verdict_under",
            { delta: fmtScore(Math.abs(mean), lang) },
          );

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4" />
          <span>{t("education_expected_title")}</span>
        </div>
      }
      hint={t("education_expected_hint")}
    >
      {verdict && <p className="text-sm">{verdict}</p>}

      {place.above.length > 0 ? (
        <ol className="mt-2 space-y-1">
          {place.above.map((s) => (
            <li key={s.id} className="flex items-baseline gap-2 text-sm">
              <div className="min-w-0 flex-1">
                <Link
                  to={`/school/${s.id}`}
                  className="block truncate hover:text-primary"
                >
                  {s.name}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {s.obshtinaName}
                  </span>
                </Link>
                {s.predicted != null && (
                  <span className="text-[11px] text-muted-foreground">
                    {t("education_expected_actual_predicted", {
                      actual: fmtScore(s.score, lang),
                      predicted: fmtScore(s.predicted, lang),
                    })}
                  </span>
                )}
              </div>
              {s.residual != null && (
                <span className="shrink-0 tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                  {fmtSigned(s.residual, lang)}
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("education_expected_none")}
        </p>
      )}

      {showVa && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("education_expected_va", {
            delta: fmtSigned(place.va.meanResidual as number, lang),
            covered: place.va.covered,
            rankable: place.rankable,
          })}
        </p>
      )}

      {/* Every score on this card is a matura average on the same basis as the
          headline tile's, and this card can render without it (step 3 places
          them independently; the município node may ship only one) — so it
          carries the year and the methodology note itself. */}
      <p className="mt-2 text-[10px] text-muted-foreground/80">
        {place.latestYear != null && `${place.latestYear} · `}
        {t("education_place_min_cohort", { min: MIN_RANK_COHORT })}{" "}
        {t("education_place_method")}
      </p>
    </StatCard>
  );
};
