// Declared wealth against peers in the same office (audit T3.9).
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
            <StatCard label={t("pp_cohort_declared")}>
              <div className="text-2xl font-bold text-foreground">
                {formatEurCompact(b.netEur, locale)}
              </div>
            </StatCard>
            {/* Median and percentile are BOTH withheld below the 20-peer floor — at two
                peers the median is one peer's exact declared figure. 097 returns null for
                each, so the two tiles must guard symmetrically; rendering the median
                unconditionally printed a blank tile on the 14/45 slices under the floor. */}
            <StatCard label={t("pp_cohort_median", { cohort: cohortLabel })}>
              {b.medianEur != null ? (
                <div className="text-2xl font-bold text-foreground">
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
                <div className="text-2xl font-bold text-foreground">
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
        </CardContent>
      </Card>
    </DashboardSection>
  );
};
