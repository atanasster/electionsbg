// /budget/methodology — how the budget pillar is sourced and built.

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
        "Where the budget data comes from, how it is processed, and what the dashboard covers."
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
        {t("budget_meth_ministries_h") ||
          "Per-ministry execution and plan-versus-actual"}
      </ArticleH2>
      <ArticleP>
        {t("budget_meth_ministries_p") ||
          "Each first-level spending unit (ministry, agency, independent body) publishes its own annual execution report. The ingest parses these PDFs into a uniform admin-grain table and reconciles them against the State Budget Law, so each ministry page shows planned versus actual at the ministry level and one column deeper at the program level."}
      </ArticleP>

      <ArticleH2>{t("budget_meth_documents_h") || "Document index"}</ArticleH2>
      <ArticleP>
        {t("budget_meth_documents_p") ||
          "Each fiscal year is linked to its source documents — the State Budget Law as promulgated in Държавен вестник, the mid-year amendment laws, the year-end execution report, and the report of the National Audit Office. The fiscal-year page surfaces the timeline and the original links."}
      </ArticleP>

      <ArticleH2>
        {t("budget_meth_procurement_h") || "Procurement cross-link"}
      </ArticleH2>
      <ArticleP>
        {t("budget_meth_procurement_p") ||
          "Each spending unit's page links to the public-procurement contracts it awarded under the Public Procurement Act, so a budget line can be followed all the way down to the individual contracts that consumed it."}
      </ArticleP>
    </ArticleLayout>
  );
};
