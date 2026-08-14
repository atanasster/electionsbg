// /budget — the module's front page.
//
// Plan: docs/plans/budget-hub-v1.md §5 / T5.3. Fourteen tiles in four bands over
// ONE stat call (`/api/db/budget-hub-stats`, migration 156, ~1.1 KB), replacing
// a screen that eagerly fetched ~1.1 MB — kfp.json 348 KB, macro_peers.json
// 784 KB, index.json and documents.json — to render two scalars.
//
// EVERY FIGURE ON THIS PAGE IS SCOPED THE WAY ITS DESTINATION IS. That is the
// skill's §0 rule and it already caught one here: the ИПОП count was keyed on
// the hub's fiscal year (2026) while the corpus is a single 2025 return, so the
// tile read „0 обекта" and landed on a page showing 3 492. 156 now scopes those
// two figures to the ИПОП corpus's own latest year and ships `ipopLatestYear`
// so the caption can name it.
//
// FIGURES ARE OMITTED, NEVER ZEROED. A structural zero — „0 разпоредители с
// отчет" on a year nobody is late for yet — is the trap that reads as a finding.
// `metricFor` returns undefined in those cases and the tile renders without a
// metric rather than with a false one.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Title } from "@/ux/Title";
import { TileHubGrid, type TileHubSection } from "@/ux/infographic";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { formatEurCompact, formatEurCompactSigned } from "@/lib/currency";
import { BUDGET_BANDS } from "./budgetRegistry";
import { BUDGET_SCENES } from "./budgetScenes";
import { HubSearch } from "@/ux/search/HubSearch";
import { budgetSearchSources } from "./budgetSearch";
import { useBudgetHubStats } from "@/data/budget/useBudgetHubStats";

interface TileMetric {
  metric: string;
  caption: string;
  secondary?: string;
}

export const BudgetHubScreen: FC = () => {
  const { t, i18n } = useTranslation();
  // ONE locale for counts and money. Every money call omitted it, so /en/budget
  // rendered „€12,8 млрд." — Bulgarian grouping and a Bulgarian magnitude word —
  // beside counts that localised correctly.
  const moneyLocale = i18n.language === "bg" ? "bg-BG" : "en-GB";
  const nf = useMemo(() => new Intl.NumberFormat(moneyLocale), [moneyLocale]);
  const { stats } = useBudgetHubStats();

  const metrics = useMemo<Record<string, TileMetric>>(() => {
    if (!stats) return {};
    const out: Record<string, TileMetric> = {};
    const fy = stats.fiscalYear;

    // The three КФП headlines. `complete: false` means the year is still
    // running, so the caption says „към <period>" rather than implying a close.
    const asOf = stats.complete
      ? t("budget_hub_metric_fy", { fy, defaultValue: "" })
      : t("budget_hub_metric_asof", {
          period: stats.latestKfpPeriod ?? "",
          defaultValue: "",
        });

    if (stats.revenueExecutedEur != null)
      out.revenue = {
        metric: formatEurCompact(stats.revenueExecutedEur, moneyLocale),
        caption: asOf,
      };
    if (stats.expenditureExecutedEur != null)
      out.spending = {
        metric: formatEurCompact(stats.expenditureExecutedEur, moneyLocale),
        caption: asOf,
      };
    if (stats.balanceExecutedEur != null)
      out.execution = {
        // SIGNED — a balance is the one figure here that can be negative, and
        // `formatEurCompact` renders „€-1,9 млрд." with the minus between the
        // symbol and the digits.
        metric: formatEurCompactSigned(stats.balanceExecutedEur, moneyLocale),
        caption: t("budget_hub_metric_balance", { defaultValue: "" }),
        // The projection disambiguates a part-year balance, which is exactly
        // what §3's „prefer the figure that disambiguates the headline" is for.
        ...(stats.balanceProjectedEur != null && !stats.complete
          ? {
              secondary: t("budget_hub_metric_balance_proj", {
                amount: formatEurCompactSigned(
                  stats.balanceProjectedEur,
                  moneyLocale,
                ),
                defaultValue: "",
              }),
            }
          : {}),
      };

    if (stats.spendingUnitCount)
      out.units = {
        metric: nf.format(stats.spendingUnitCount),
        caption: t(
          stats.spendingUnitCount === 1
            ? "budget_hub_metric_units_one"
            : "budget_hub_metric_units_other",
          { fy, n: nf.format(stats.spendingUnitCount), defaultValue: "" },
        ),
      };

    // Deviations carries a metric ONLY when somebody has reported. On the
    // current year `varianceCoveredUnits` is 0 because the year has not closed
    // — a structural zero, and „0" on a tile reads as a finding about the
    // ministries rather than about the calendar.
    if (stats.varianceCoveredUnits)
      out.deviations = {
        metric: nf.format(stats.varianceCoveredUnits),
        caption: t(
          stats.varianceCoveredUnits === 1
            ? "budget_hub_metric_deviations_one"
            : "budget_hub_metric_deviations_other",
          { fy, defaultValue: "" },
        ),
      };

    // The DESTINATION's own lead: „N от 8 ключови документа". 33 is the record
    // count, which appears nowhere on that page — the „destination counts a
    // different set" trap, one row down from the ИПОП one.
    // Already a COUNT in the blob (4), not an array — 156 aggregates it.
    if (stats.obsCategoriesPresent)
      out.law = {
        metric: `${stats.obsCategoriesPresent}/8`,
        caption: t("budget_hub_metric_docs", { defaultValue: "" }),
        secondary: t("budget_hub_metric_docs_all", {
          n: nf.format(stats.documentCountAllYears ?? 0),
          defaultValue: "",
        }),
      };

    if (stats.muniTransferPlannedEur != null)
      out.municipal = {
        metric: formatEurCompact(stats.muniTransferPlannedEur, moneyLocale),
        // „Planned" is the fork this key has to name — чл. 53 is an
        // appropriation, not money paid out.
        caption: t("budget_hub_metric_muni", { fy, defaultValue: "" }),
      };

    // ИПОП is scoped to ITS OWN year, and the caption says which — otherwise a
    // 2025 figure sits under a 2026 page selector with nothing to explain it.
    if (stats.ipopProjectCount)
      out.muniInvestments = {
        metric: nf.format(stats.ipopProjectCount),
        caption: t(
          stats.ipopProjectCount === 1
            ? "budget_hub_metric_ipop_one"
            : "budget_hub_metric_ipop_other",
          { year: stats.ipopLatestYear ?? "", defaultValue: "" },
        ),
        ...(stats.ipopStalledCount
          ? {
              secondary: t("budget_hub_metric_ipop_flagged", {
                // NOT `count` — i18next treats that as a plural selector and
                // the typed overload then refuses a string. The suffix is
                // chosen in the copy, which this page does not vary anyway.
                n: nf.format(stats.ipopStalledCount),
                defaultValue: "",
              }),
            }
          : {}),
      };

    if (stats.capitalMunicipalityCount)
      out.muniCapital = {
        metric: nf.format(stats.capitalMunicipalityCount),
        caption: t(
          // „1 общини" does not agree, and one is the live value.
          stats.capitalMunicipalityCount === 1
            ? "budget_hub_metric_capital_one"
            : "budget_hub_metric_capital_other",
          { year: stats.capitalLatestYear ?? "", defaultValue: "" },
        ),
      };

    return out;
  }, [stats, t, nf]);

  const sections: TileHubSection[] = useMemo(
    () =>
      BUDGET_BANDS.map((band) => ({
        heading: t(band.labelKey),
        description: t(band.descKey),
        tiles: band.tiles.map((tile) => ({
          to: tile.to,
          title: t(tile.titleKey),
          desc: t(tile.descKey),
          accent: tile.accent,
          scene: BUDGET_SCENES[tile.id],
          // NO `cta`. The whole card is the link and carries a hover state;
          // „разгледай →" on fourteen tiles is one affordance restated.
          ...(metrics[tile.id]
            ? {
                metric: metrics[tile.id].metric,
                metricCaption: metrics[tile.id].caption,
                ...(metrics[tile.id].secondary
                  ? { metricSecondary: metrics[tile.id].secondary }
                  : {}),
              }
            : {}),
        })),
      })),
    [t, metrics],
  );

  // Both sources are server-backed, so nothing is fetched until the reader
  // types — a visitor who never searches pays nothing for the box.
  const searchSources = useMemo(
    () =>
      budgetSearchSources({
        fy: stats?.fiscalYear ?? null,
        bg: i18n.language === "bg",
      }),
    [stats?.fiscalYear, i18n.language],
  );

  const pageTitle = t("budget_hub_title");

  return (
    <>
      <Title description={t("budget_hub_description")}>{pageTitle}</Title>
      <GovernanceBreadcrumb
        sectionKey="budget_link_label"
        sectionTo="/budget"
        className="mt-5"
      />

      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        {t("budget_hub_intro")}
      </p>

      {/* Directly under the intro and above the first band: the fastest route
          to a destination, where the tiles are the slow one. A reader who
          arrives knowing „Министерство на отбраната" or „Пловдив" should not
          have to work out which of fourteen tiles contains it. */}
      <HubSearch
        sources={searchSources}
        idPrefix="budget-search"
        className="mt-4 max-w-2xl"
        title={{ bg: "Търсене в бюджета", en: "Search the budget" }}
        placeholder={{
          bg: "разпоредител или община…",
          en: "a spending unit or a municipality…",
        }}
        hint={{
          bg: "Първостепенните разпоредители и всички 265 общини.",
          en: "First-level spending units and all 265 municipalities.",
        }}
      />

      <div data-og="budget-hub">
        <TileHubGrid sections={sections} className="mt-6" />
      </div>

      {/* The two pages the tile grid deliberately does not front, linked here
          so neither is an orphan. Moving /budget to the hub took the deep dive
          out of the router's front door AND took /budget/methodology with it —
          its only inbound link was ON the deep-dive page. */}
      <p className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Link to="/budget/deep-dive" className="text-primary hover:underline">
          {t("budget_hub_deep_dive")}
        </Link>
        <Link to="/budget/methodology" className="text-primary hover:underline">
          {t("budget_methodology_link")}
        </Link>
        <Link
          to="/budget/tax-calculator"
          className="text-primary hover:underline"
        >
          {t("budget_hub_tax_calculator")}
        </Link>
      </p>

      <p className="mt-3 text-[11px] text-muted-foreground/80">
        {t("budget_hub_source")}
      </p>
    </>
  );
};
