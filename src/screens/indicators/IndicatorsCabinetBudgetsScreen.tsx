// /indicators/budgets — "Бюджети по кабинети". The cabinet budget scorecard
// (hero chart + era-grouped per-year table) on its own page; it outgrew being a
// section of the fiscal screen. Sits in the CabinetAnchoredLayoutScreen group so
// the election / cabinet anchor in the URL survives navigation here.

import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useGovernments } from "@/data/governments/useGovernments";
import { useFinanceMinisters } from "@/data/governments/useFinanceMinisters";
import { useBudgetLaws } from "@/data/governments/useBudgetLaws";
import { useMacro } from "@/data/macro/useMacro";
import { CabinetBudgetScorecard } from "@/screens/components/macro/CabinetBudgetScorecard";
import { IzdrazhkaHeatmapTile } from "@/screens/components/budget/IzdrazhkaHeatmapTile";
import { IndicatorsNav } from "./indicatorsNav";
import { ChartSources } from "./indicatorsShared";

export const IndicatorsCabinetBudgetsScreen = () => {
  const { t } = useTranslation();
  const { data: governments } = useGovernments();
  const { data: financeMinisters } = useFinanceMinisters();
  const { data: budgetLaws } = useBudgetLaws();
  const { data: macro } = useMacro();

  return (
    <div className="pb-12">
      <Title>{t("cabinet_budgets_heading")}</Title>
      <IndicatorsNav />
      {governments ? (
        <CabinetBudgetScorecard
          governments={governments}
          financeMinisters={financeMinisters ?? []}
          budgetLaws={budgetLaws ?? []}
          macro={macro}
        />
      ) : null}
      <IzdrazhkaHeatmapTile
        financeMinisters={financeMinisters ?? []}
        budgetLaws={budgetLaws ?? []}
      />
      {/* Full methodology + sources sit below the charts so the visualisation
          gets the top of the page. Split into self-contained, labelled blocks in
          a responsive grid — fills the full-width dashboard without the random
          mid-sentence breaks a single paragraph flowed into CSS columns gives. */}
      <div className="mt-8 border-t border-border/40 pt-4">
        <p className="mb-4 text-sm font-medium text-foreground">
          {t("cabinet_budgets_about_lead")}
        </p>
        <div className="mb-3 grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["cabinet_budgets_about_what_h", "cabinet_budgets_about_what_b"],
              [
                "cabinet_budgets_about_measures_h",
                "cabinet_budgets_about_measures_b",
              ],
              [
                "cabinet_budgets_about_sources_h",
                "cabinet_budgets_about_sources_b",
              ],
            ] as const
          ).map(([h, b]) => (
            <div key={h}>
              <h3 className="mb-1 text-xs font-semibold text-foreground">
                {t(h)}
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t(b)}
              </p>
            </div>
          ))}
        </div>
        <ChartSources
          prefix={t("governments_chart_sources_prefix")}
          sources={[
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/gov_10q_ggnfa/default/table",
              label:
                "Eurostat gov_10q_ggnfa (net lending/borrowing — annual budget balance, % of GDP)",
            },
            {
              href: "https://www.minfin.bg/bg/statistics/13",
              label:
                "Министерство на финансите — Консолидирана фискална програма (касов баланс, КФП)",
            },
            {
              href: "https://www.minfin.bg/bg/statistics/10",
              label:
                "Министерство на финансите — Просрочени задължения (year-end consolidated stock)",
            },
            {
              href: "https://www.minfin.bg/bg/statistics/5",
              label:
                "Министерство на финансите — Фискален резерв (year-end stock)",
            },
          ]}
        />
      </div>
    </div>
  );
};
