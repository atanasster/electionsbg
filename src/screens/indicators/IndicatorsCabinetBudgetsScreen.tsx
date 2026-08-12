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
import { useIzdrazhkaByInstitution } from "@/data/budget/useIzdrazhkaByInstitution";
import { IndicatorsNav } from "./indicatorsNav";
import { ChartSources } from "./indicatorsShared";

export const IndicatorsCabinetBudgetsScreen = () => {
  const { t } = useTranslation();
  const governmentsQ = useGovernments();
  const financeMinistersQ = useFinanceMinisters();
  const budgetLawsQ = useBudgetLaws();
  const macroQ = useMacro();
  const heatmapQ = useIzdrazhkaByInstitution();

  // Nothing below the header renders until EVERY payload has settled, and this
  // page is the one in the group that genuinely needs the whole set rather than
  // the primary one.
  //
  // It measured 1.3276 CLS — 13x the CWV budget, the worst route here (built
  // dist, Pixel 5, 150ms RTT, 1.6Mbps, 4x CPU). Three separate arrivals each
  // shoved visible content off the viewport, and fixing them one at a time just
  // moved the score between them: gate the body on governments.json and the
  // heatmap tile still inserted above the footnotes (0.6430); gate the footnotes
  // on the heatmap too and the SCORECARD still grew underneath both as
  // macro.json and budget_laws.json arrived (0.6637), because it renders from
  // four payloads and is nearly empty until the last of them lands.
  //
  // Reserving in place would mean inventing a height for an era-grouped table
  // whose row count is the data — a guess, and a wrong guess is still a shift.
  // The page has two honest states: its header, or all of it. The cost is that
  // the hero waits for the slowest of five payloads instead of the first; the
  // header is real content, and everything else appends below it, which shifts
  // nothing.
  //
  // `isPending`, never the data: every one of these fetchers turns a non-ok
  // response into a resolved undefined/null/[] that react-query records as
  // SUCCESS. Keyed on the data, a single 404 would leave this page showing its
  // header for ever.
  const pending =
    governmentsQ.isPending ||
    financeMinistersQ.isPending ||
    budgetLawsQ.isPending ||
    macroQ.isPending ||
    heatmapQ.isPending;

  const header = (
    <>
      <Title>{t("cabinet_budgets_heading")}</Title>
      <IndicatorsNav />
    </>
  );

  if (pending) {
    return <div className="pb-12">{header}</div>;
  }

  const governments = governmentsQ.data ?? [];
  const financeMinisters = financeMinistersQ.data ?? [];
  const budgetLaws = budgetLawsQ.data ?? [];

  return (
    <div className="pb-12">
      {header}
      <CabinetBudgetScorecard
        governments={governments}
        financeMinisters={financeMinisters}
        budgetLaws={budgetLaws}
        macro={macroQ.data}
      />
      <IzdrazhkaHeatmapTile
        financeMinisters={financeMinisters}
        budgetLaws={budgetLaws}
      />
      {/* Full methodology + sources sit below the charts so the visualisation
          gets the top of the page. Split into self-contained, labelled blocks in
          a responsive grid — fills the full-width dashboard without the random
          mid-sentence breaks a single paragraph flowed into CSS columns gives.

          Being LAST is what made this block the victim of every late arrival
          above it, and why the whole-page gate above is what fixes it: reached
          here, everything that could push this block already exists. */}
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
