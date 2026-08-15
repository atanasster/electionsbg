// Declared wealth AND declared income against peers in the same office (audit T3.9).
//
// Income was added because it is the figure the coverage leads with — a nova card for a
// vice-president is three lines and one of them is „Доход" — while on this page it sat only
// inside the declaration detail. It is a separate row with its OWN peer count and its own
// 20-peer floor: a filing can declare assets and no income, so the wealth population is not
// the income population (49 of 66 slices clear the floor on income against 52 on wealth),
// and one shared count would publish a percentile over a population that never earned it.
//
// A raw net-worth figure means little alone; the informative comparison is against people
// holding the SAME kind of office in the SAME year — same filing rules, same form, same
// reporting period. 097 enforces both, plus a 20-peer floor below which the percentile is
// withheld rather than published against a name.
//
// FRAMING. This is NOT the accumulation gap (T3.2) and must not read like it: it makes no
// claim about where anything came from. Both sides of the comparison are self-declared, and
// the caveat says so. No colour-coding — a high percentile is not an allegation.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card, CardContent } from "@/ux/Card";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";
import { usePersonCohortBenchmark } from "./usePersonCohortBenchmark";

export const PersonCohortBenchmark: FC<{ slug: string }> = ({ slug }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "bg" ? "bg-BG" : "en-US";
  const b = usePersonCohortBenchmark(slug);

  // Self-hides for anyone with no cohort or no declared wealth.
  if (!b) return null;
  const cohortLabel = t(`pp_cohort_${b.cohort}`);

  return (
    <DashboardSection
      id="person-cohort"
      title={t("pp_cohort_title")}
      icon={Users}
      subtitle={t("pp_cohort_hint", { cohort: cohortLabel, year: b.year })}
    >
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {/* The subject's own figure takes the full row on a phone: it is the headline of
                the comparison, and it is also the longest string here — a half-width tile is
                ~103px of content box, while "€194,6 хил." joins its unit with a non-breaking
                space and so overflows instead of wrapping. Median and percentile are shorter
                and share the second row. */}
            <StatCard
              label={t("pp_cohort_declared")}
              className="col-span-2 sm:col-span-1"
            >
              <div className="text-xl font-bold text-foreground sm:text-2xl">
                {formatEurCompact(b.netEur, locale)}
              </div>
            </StatCard>
            {/* Median and percentile are BOTH withheld below the 20-peer floor — at two
                peers the median is one peer's exact declared figure. 097 returns null for
                each, so the two tiles must guard symmetrically; rendering the median
                unconditionally printed a blank tile on the 14/45 slices under the floor. */}
            <StatCard label={t("pp_cohort_median", { cohort: cohortLabel })}>
              {b.medianEur != null ? (
                <div className="text-xl font-bold text-foreground sm:text-2xl">
                  {formatEurCompact(b.medianEur, locale)}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {t("pp_cohort_too_few")}
                </div>
              )}
            </StatCard>
            <StatCard label={t("pp_cohort_percentile")}>
              {b.percentile != null ? (
                <div className="text-xl font-bold text-foreground sm:text-2xl">
                  {b.percentile}%
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {t("pp_cohort_too_few")}
                </div>
              )}
            </StatCard>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("pp_cohort_peers", { count: b.peers, year: b.year })}{" "}
            {t("pp_cohort_caveat")}
          </p>

          {/* Income is the figure the press leads with — nova's card for Йотова is three
              lines and one of them is „Доход" — but it lived only inside the declaration
              detail, below the fold. It is a FLOW, not a holding, so it is a second row here
              rather than a band in the composition chart or a term in net worth.
              Rendered only when the person declared income AND the slice clears its own
              20-peer floor; `incomeEur` is null for a zero, because "reported nothing" is a
              different statement from a number. */}
          {b.incomeEur != null && (
            <div className="mt-4 border-t pt-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatCard
                  label={t("pp_cohort_income")}
                  className="col-span-2 sm:col-span-1"
                >
                  <div className="text-xl font-bold text-foreground sm:text-2xl">
                    {formatEurCompact(b.incomeEur, locale)}
                  </div>
                </StatCard>
                <StatCard
                  label={t("pp_cohort_income_median", { cohort: cohortLabel })}
                >
                  {b.incomeMedianEur != null ? (
                    <div className="text-xl font-bold text-foreground sm:text-2xl">
                      {formatEurCompact(b.incomeMedianEur, locale)}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {t("pp_cohort_too_few")}
                    </div>
                  )}
                </StatCard>
                <StatCard label={t("pp_cohort_income_percentile")}>
                  {b.incomePercentile != null ? (
                    <div className="text-xl font-bold text-foreground sm:text-2xl">
                      {b.incomePercentile}%
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {t("pp_cohort_too_few")}
                    </div>
                  )}
                </StatCard>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {t("pp_cohort_income_peers", {
                  count: b.incomePeers ?? 0,
                  year: b.year,
                })}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </DashboardSection>
  );
};
