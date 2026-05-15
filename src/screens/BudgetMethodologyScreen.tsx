// /budget/methodology — how the budget pillar is sourced and built. Phase 1
// scope: the КФП execution feed. Later phases (ministry breakdown, program
// reconciliation, procurement cross-link) are described as planned, not
// claimed as built.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ArticleLayout } from "@/components/article/ArticleLayout";
import {
  ArticleH2,
  ArticleP,
  ArticleUL,
  ArticleLI,
  ArticleStrong,
} from "@/components/article/ArticleProse";

export const BudgetMethodologyScreen: FC = () => {
  const { t } = useTranslation();
  return (
    <ArticleLayout
      title={t("budget_methodology_title") || "State budget — methodology"}
      description={
        t("budget_methodology_description") ||
        "Where the budget data comes from, how it is processed, and what it does and does not yet cover."
      }
      breadcrumb={{
        to: "/budget",
        label: t("budget_index_title") || "State budget",
      }}
      seoType="website"
    >
      <ArticleH2>{t("budget_meth_source_h") || "Data source"}</ArticleH2>
      <ArticleP>
        {t("budget_meth_source_p") ||
          "The figures come from the Ministry of Finance dataset “state budget execution by major budget indicators”, published on the national open-data portal data.egov.bg under a public-domain (CC0) licence. The Ministry publishes one resource per monthly cash-execution snapshot; each lists, for the five top-level sections of the state budget, the amount set by the budget law and the amount executed so far that fiscal year."}
      </ArticleP>

      <ArticleH2>{t("budget_meth_sections_h") || "What is shown"}</ArticleH2>
      <ArticleP>
        {t("budget_meth_sections_p") ||
          "The Bulgarian state budget execution table has five top-level sections, and the dashboard tracks each of them over time:"}
      </ArticleP>
      <ArticleUL>
        <ArticleLI>
          <ArticleStrong>
            {t("budget_series_revenue") || "Revenue"}
          </ArticleStrong>{" "}
          {t("budget_meth_revenue") ||
            "— tax and non-tax revenue, grants and donations."}
        </ArticleLI>
        <ArticleLI>
          <ArticleStrong>
            {t("budget_series_expenditure") || "Expenditure"}
          </ArticleStrong>{" "}
          {t("budget_meth_expenditure") ||
            "— spending and transfers: personnel, operations, capital, social spending, subsidies, interest."}
        </ArticleLI>
        <ArticleLI>
          <ArticleStrong>
            {t("budget_series_euContribution") || "EU budget contribution"}
          </ArticleStrong>{" "}
          {t("budget_meth_eu") ||
            "— Bulgaria's contribution to the common EU budget."}
        </ArticleLI>
        <ArticleLI>
          <ArticleStrong>
            {t("budget_series_balance") || "Balance"}
          </ArticleStrong>{" "}
          {t("budget_meth_balance") ||
            "— revenue minus expenditure minus the EU contribution. Negative means a deficit."}
        </ArticleLI>
        <ArticleLI>
          <ArticleStrong>
            {t("budget_series_financing") || "Financing"}
          </ArticleStrong>{" "}
          {t("budget_meth_financing") ||
            "— how the balance is financed: external and domestic borrowing, deposits, privatisation."}
        </ArticleLI>
      </ArticleUL>

      <ArticleH2>
        {t("budget_meth_currency_h") || "Currency and the euro changeover"}
      </ArticleH2>
      <ArticleP>
        {t("budget_meth_currency_p") ||
          "Bulgaria adopted the euro on 1 January 2026. Monthly snapshots up to and including December 2025 are published in leva; from January 2026 they are in euro. Every figure on the dashboard is shown in euro."}
      </ArticleP>

      <ArticleH2>
        {t("budget_meth_cumulative_h") || "Cumulative execution"}
      </ArticleH2>
      <ArticleP>
        {t("budget_meth_cumulative_p") ||
          "Each monthly snapshot is cumulative year-to-date: the December figure is the whole year, and the series resets each January. The execution-trend chart shows this directly — a ramp within each fiscal year, then a reset."}
      </ArticleP>

      <ArticleH2>{t("budget_meth_integrity_h") || "Data integrity"}</ArticleH2>
      <ArticleP>
        {t("budget_meth_integrity_p") ||
          "The ingest fails loudly rather than publish partial data: a pinned snapshot is re-parsed on every run and byte-compared against a committed fixture, so any drift in the parser is caught before anything is written, and a change touching more than a small fraction of the data aborts the run for review."}
      </ArticleP>

      <ArticleH2>
        {t("budget_meth_flow_h") || "The budget-flow графика"}
      </ArticleH2>
      <ArticleP>
        {t("budget_meth_flow_p") ||
          "The flow графика on /budget composes two side-by-side Sankey diagrams — revenue on the left, spending on the right — meeting at a balance bridge. Both columns of the bridge are drawn at the same full height, so the gap between revenue and spending is visually filled by a hatched wedge: the financing that closes the accounting identity (revenue = spending + balance, with balance covered by financing). The metaphor is borrowed from the usafacts.org US-budget visual."}
      </ArticleP>
      <ArticleP>
        {t("budget_meth_flow_hierarchy_p") ||
          "The Sankey columns need a leaf-→-group hierarchy, but the КФП source publishes one flat label column with no indentation or code. The ingest reconstructs the hierarchy by running-sum matching: a row whose value equals the sum of the rows that immediately follow it (within rounding tolerance) is marked as a subtotal and those rows become its children. Signed-net subtotals — like “Transfers (net) = Предоставени − Получени”, where one child is conceptually subtracted — are detected by a fallback rule that flips the sign of one consumed child and re-checks the match. A canary on every snapshot asserts that top-level rows sum back to the section total."}
      </ArticleP>
      <ArticleP>
        {t("budget_meth_flow_grain_p") ||
          "Two decompositions are available via a toggle. The default — by category — uses the КФП execution snapshot (Personnel / Operations / Capital / Transfers / etc.). The alternative — by spending unit — uses the State Budget Law plan, with one leaf per ministry. The two views have different totals: КФП execution covers all expenditure including transfers; admin grain covers each unit's direct appropriation only. The bridge math stays based on the КФП snapshot to keep the deficit/surplus number honest; the admin Sankey is a different way to slice the right-hand side."}
      </ArticleP>

      <ArticleH2>
        {t("budget_meth_scope_h") || "Scope and what comes next"}
      </ArticleH2>
      <ArticleP>
        {t("budget_meth_scope_p") ||
          "Built so far: the top-level consolidated execution series for the state budget, the budget-flow графика with both economic and ministry-grain decompositions, plan-versus-actual variance at ministry and program grain, an index of the underlying documents (the budget law, amendments, the year-end execution report, and the National Audit Office report), and a cross-link from each spending unit to the contracts it awarded under public-procurement law. Planned next: continued backfill of per-ministry execution reports for prior fiscal years, and a program-by-program Sankey one column deeper than the current ministry view."}
      </ArticleP>
    </ArticleLayout>
  );
};
