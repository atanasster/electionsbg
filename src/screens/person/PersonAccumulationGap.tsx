// The accumulation gap (audit T3.2 / feature 3.2): the change in declared net worth over
// a person's filing history, against the income they declared across the same span. It is
// the discrepancy КПКОНПИ is statutorily meant to examine and which is published nowhere
// else in an accessible form.
//
// THIS NAMES AN INDIVIDUAL. It is governed by docs/methodology/accumulation-gap.md, and
// three of that page's rules are structural here, not stylistic:
//
//   1. The COHORT gate is server-side — person_accumulation_gap (092) returns null for
//      anyone outside accountability_senior (091), so this component renders nothing for a
//      councillor or a lower official. There is no client-side cohort check to get wrong.
//   2. The unvalued-real-estate DENOMINATOR is shown whenever it is non-zero, and the
//      figure is explicitly labelled imprecise when it is. Unvalued property counts as €0,
//      so a gap computed over a portfolio containing it cannot be presented as exact.
//   3. The LANGUAGE is descriptive. The copy says the declared income does not by itself
//      account for the increase; it never says "unexplained" or "hidden" wealth, and the
//      list of legitimate untracked sources (inheritance, restitution, a sale, a spouse's
//      income) sits next to the number, not behind a tooltip.
//
// A negative gap — income exceeding the wealth change, the ordinary case — is shown just
// as plainly as a positive one. Suppressing it would make the positive case read as an
// accusation by default.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card, CardContent } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { usePersonAccumulationGap } from "./usePersonAccumulationGap";

export const PersonAccumulationGap: FC<{ slug: string }> = ({ slug }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "bg" ? "bg-BG" : "en-US";
  const gap = usePersonAccumulationGap(slug);

  // null = outside the cohort, or fewer than two asset-bearing filings. Either way there
  // is nothing defensible to show.
  if (!gap) return null;

  const positive = gap.gapEur > 0;
  const imprecise = gap.unvaluedRealEstate > 0;

  return (
    <DashboardSection
      id="person-gap"
      title={t("pp_gap_title")}
      icon={Scale}
      subtitle={t("pp_gap_hint", {
        from: gap.fromYear,
        to: gap.toYear,
      })}
    >
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Figure
              label={t("pp_gap_delta_net")}
              value={formatEur(gap.deltaNetEur, locale)}
              sub={t("pp_gap_delta_net_sub", {
                from: formatEur(gap.fromNetEur, locale),
                to: formatEur(gap.toNetEur, locale),
              })}
            />
            <Figure
              label={t("pp_gap_income")}
              value={formatEur(gap.declaredIncomeEur, locale)}
              sub={t("pp_gap_income_sub", { years: gap.years })}
            />
            {/* The gap is NOT colour-coded. Amber on a positive gap would editorialise
                what the words deliberately do not: the copy says the declared income does
                not by itself account for the change, and a warning colour would turn that
                into an allegation the methodology forbids. Only the imprecision caveat
                below is amber, because that IS a warning — about our own figure. */}
            <Figure
              label={t("pp_gap_gap")}
              value={formatEur(gap.gapEur, locale)}
              sub={
                positive ? t("pp_gap_positive_sub") : t("pp_gap_negative_sub")
              }
            />
          </div>

          {/* The caveats are part of the claim, not a footnote. */}
          <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
            <p>{t("pp_gap_caveat_declared")}</p>
            {imprecise && (
              <p className="font-medium text-amber-700 dark:text-amber-500">
                {t("pp_gap_caveat_unvalued", {
                  count: gap.unvaluedRealEstate,
                })}
              </p>
            )}
            <p>{t("pp_gap_caveat_sources")}</p>
            <p>
              <a
                href="/about#accumulation-gap"
                className="text-primary hover:underline"
              >
                {t("pp_gap_methodology")}
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </DashboardSection>
  );
};

const Figure: FC<{
  label: string;
  value: string;
  sub: string;
}> = ({ label, value, sub }) => (
  <div>
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="text-2xl font-bold tabular-nums text-foreground">
      {value}
    </div>
    <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
  </div>
);
