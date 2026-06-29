// /indicators/fiscal — Fiscal % GDP, Fiscal nominal, Fiscal reserve, Debt
// emissions, Government size, EU funds. Carries the #debt-emissions anchor
// that GovernanceDebtTile deep-links to.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { Title } from "@/ux/Title";
import { useHashScroll } from "@/ux/useHashScroll";
import { useGovernments } from "@/data/governments/useGovernments";
import { MacroPayload, MacroPoint, useMacro } from "@/data/macro/useMacro";
import { useMacroPeers } from "@/data/macro/useMacroPeers";
import { useCompareToggle } from "@/data/macro/useCompareToggle";
import {
  CabinetStrip,
  GovernmentTimeline,
  type PeerOverlay,
} from "@/screens/components/governments/GovernmentTimeline";
import {
  initialIndicatorToggle,
  type IndicatorToggle,
} from "@/screens/components/governments/indicatorToggle";
import type { MacroIndicatorKey } from "@/data/macro/useMacro";
import { DebtEmissionsTable } from "@/screens/components/governments/DebtEmissionsTable";
import { xDomainFor } from "@/screens/components/governments/governmentTimelineUtils";
import { PeerSnapshotTable } from "@/screens/components/macro/PeerSnapshotTable";
import { FdiMonthlyTile } from "@/screens/components/macro/FdiMonthlyTile";
import { CompareToggleButton } from "@/screens/components/macro/CompareToggleButton";
import { IndicatorsNav } from "./indicatorsNav";
import { ChartSources } from "./indicatorsShared";

const FISCAL_INDICATOR_KEYS: MacroIndicatorKey[] = [
  "govDebt",
  "budgetBalance",
  "currentAccount",
];

export const IndicatorsFiscalScreen = () => {
  const { t, i18n } = useTranslation();
  const { search } = useLocation();
  const { data: governments } = useGovernments();
  const { data: macro } = useMacro();
  const { data: peers } = useMacroPeers();
  const [compare, toggleCompare] = useCompareToggle();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";

  useHashScroll([macro, governments]);

  const peerOverlay = useMemo<PeerOverlay | undefined>(() => {
    if (!peers?.indicators) return undefined;
    return peers.indicators as PeerOverlay;
  }, [peers]);

  const [fiscalEnabled, setFiscalEnabled] = useState<IndicatorToggle>(() =>
    initialIndicatorToggle(FISCAL_INDICATOR_KEYS),
  );

  const xDomain = useMemo<[number, number] | null>(
    () => (governments ? xDomainFor(governments) : null),
    [governments],
  );

  // Derive net-new-debt-per-quarter from the cumulative debt stock. Same
  // formula the legacy IndicatorsScreen used.
  const enrichedMacro = useMemo<MacroPayload | undefined>(() => {
    if (!macro) return undefined;
    const debt = macro.series.govDebtNominal ?? [];
    if (debt.length < 2) return macro;
    const debtIssuance: MacroPoint[] = [];
    for (let i = 1; i < debt.length; i++) {
      debtIssuance.push({
        year: debt[i].year,
        quarter: debt[i].quarter,
        period: debt[i].period,
        value: Math.round((debt[i].value - debt[i - 1].value) * 100) / 100,
      });
    }
    return {
      ...macro,
      indicators: {
        ...macro.indicators,
        debtIssuance: {
          titleEn: "Net new debt issued (per quarter)",
          titleBg: "Нов дълг, емитиран за тримесечие",
          unitLabelEn: "EUR million (Δ debt stock, quarter-on-quarter)",
          unitLabelBg: "млн. евро (Δ дълг спрямо предходно тримесечие)",
          cadence: "quarterly",
          source: "eurostat",
          sourceUrl:
            "https://ec.europa.eu/eurostat/databrowser/view/gov_10q_ggdebt/default/table",
          datasetCode: "gov_10q_ggdebt",
        },
      },
      series: { ...macro.series, debtIssuance },
    };
  }, [macro]);

  if (!governments) {
    return (
      <div className="pb-12">
        <Title>{t("indicators_fiscal_title")}</Title>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <Title description={t("indicators_fiscal_description")}>
        {t("indicators_fiscal_title")}
      </Title>

      <IndicatorsNav />

      <div className="mb-4 flex justify-end">
        <CompareToggleButton enabled={compare} onToggle={toggleCompare} />
      </div>

      {xDomain ? (
        <CabinetStrip
          governments={governments}
          xDomain={xDomain}
          lang={lang}
          mobileScrollable
        />
      ) : null}

      <section className="mb-10">
        <Link
          to={{ pathname: "/indicators/budgets", search }}
          className="block rounded-lg border border-border p-4 transition-colors hover:bg-accent/10"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold mb-1">
                {t("cabinet_budgets_heading")}
              </h2>
              <p className="text-xs text-muted-foreground max-w-2xl">
                {t("cabinet_budgets_teaser")}
              </p>
            </div>
            <span className="shrink-0 whitespace-nowrap text-sm text-primary">
              {t("cabinet_budgets_open")} →
            </span>
          </div>
        </Link>
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_fiscal")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_chart_fiscal_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_sources_prefix")}
          sources={[
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/gov_10q_ggdebt/default/table",
              label:
                "Eurostat gov_10q_ggdebt (government gross debt, % of GDP)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/gov_10q_ggnfa/default/table",
              label: "Eurostat gov_10q_ggnfa (net lending/borrowing, % of GDP)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/ei_bpm6ca_q/default/table",
              label: "Eurostat ei_bpm6ca_q (current account balance, % of GDP)",
            },
          ]}
        />
        {compare && (
          <PeerSnapshotTable
            rows={[
              { indicatorKey: "govDebt" },
              { indicatorKey: "budgetBalance" },
              { indicatorKey: "currentAccount" },
            ].filter((r) => fiscalEnabled[r.indicatorKey as MacroIndicatorKey])}
          />
        )}
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={FISCAL_INDICATOR_KEYS}
          enabled={fiscalEnabled}
          onEnabledChange={setFiscalEnabled}
          yAxisFormatter={(v) => `${v}%`}
          unitFormatter={(_k, v) => `${v.toFixed(1)}%`}
          showZeroLine
          height={320}
          peerOverlay={peerOverlay}
          peerCompareEnabled={compare}
        />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_fiscal_nominal")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_chart_fiscal_nominal_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_sources_prefix")}
          sources={[
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/gov_10q_ggdebt/default/table",
              label: "Eurostat gov_10q_ggdebt (gross debt, EUR million)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/gov_10q_ggnfa/default/table",
              label:
                "Eurostat gov_10q_ggnfa (net lending/borrowing, EUR million)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/ei_bpm6ca_q/default/table",
              label:
                "Eurostat ei_bpm6ca_q (current account balance, EUR million)",
            },
          ]}
        />
        <h3 className="text-sm font-medium mb-2">
          {t("governments_chart_fiscal_nominal_stock")}
        </h3>
        <GovernmentTimeline
          governments={governments}
          macro={enrichedMacro}
          indicatorKeys={["govDebtNominal"]}
          yAxisFormatter={(v) => `€${(v / 1000).toFixed(0)}B`}
          unitFormatter={(_k, v) => `€${(v / 1000).toFixed(2)}B`}
          height={260}
        />
        <h3 className="text-sm font-medium mt-6 mb-2">
          {t("governments_chart_fiscal_nominal_flows")}
        </h3>
        <GovernmentTimeline
          governments={governments}
          macro={enrichedMacro}
          indicatorKeys={[
            "debtIssuance",
            "budgetBalanceNominal",
            "currentAccountNominal",
          ]}
          yAxisFormatter={(v) => `€${v.toLocaleString()}M`}
          unitFormatter={(_k, v) => `€${v.toFixed(0)}M`}
          showZeroLine
          height={320}
        />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_fiscal_reserve")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_chart_fiscal_reserve_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_sources_prefix")}
          sources={[
            {
              href: "https://www.minfin.bg/bg/statistics/5",
              label:
                "Министерство на финансите — месечни бюлетини по КФП (ред „Фискален резерв“; архивирани чрез Wayback Machine)",
            },
          ]}
        />
        <GovernmentTimeline
          governments={governments}
          macro={enrichedMacro}
          indicatorKeys={["fiscalReserve"]}
          yAxisFormatter={(v) => `€${(v / 1000).toFixed(1)}B`}
          unitFormatter={(_k, v) => `€${(v / 1000).toFixed(2)}B`}
          height={280}
          horizontalReferences={[
            {
              y: 2300,
              label: t("governments_chart_fiscal_reserve_floor"),
              color: "#b45309",
            },
          ]}
        />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_government_size")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_chart_government_size_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_sources_prefix")}
          sources={[
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/gov_10q_ggnfa/default/table",
              label:
                "Eurostat gov_10q_ggnfa (general government revenue + expenditure, EUR million, SCA)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/nama_10_gdp/default/table",
              label: "Eurostat nama_10_gdp (nominal GDP, annual, EUR million)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/bop_fdi6_flow/default/table",
              label:
                "Eurostat bop_fdi6_flow (net FDI inward, BPM6, annual, EUR million)",
            },
          ]}
        />
        <GovernmentTimeline
          governments={governments}
          macro={enrichedMacro}
          indicatorKeys={["govRevenue", "govExpenditure"]}
          yAxisFormatter={(v) => `€${(v / 1000).toFixed(0)}B`}
          unitFormatter={(_k, v) => `€${(v / 1000).toFixed(2)}B`}
          height={280}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-6">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              {macro?.indicators.nominalGdp &&
                (lang === "bg"
                  ? macro.indicators.nominalGdp.titleBg
                  : macro.indicators.nominalGdp.titleEn)}
            </div>
            <GovernmentTimeline
              governments={governments}
              macro={macro}
              indicatorKeys={["nominalGdp"]}
              yAxisFormatter={(v) => `€${(v / 1000).toFixed(0)}B`}
              unitFormatter={(_k, v) => `€${(v / 1000).toFixed(1)}B`}
              hideToggles
              height={220}
            />
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              {enrichedMacro?.indicators.fdiInward &&
                (lang === "bg"
                  ? enrichedMacro.indicators.fdiInward.titleBg
                  : enrichedMacro.indicators.fdiInward.titleEn)}
            </div>
            <GovernmentTimeline
              governments={governments}
              macro={enrichedMacro}
              indicatorKeys={["fdiInward"]}
              yAxisFormatter={(v) => `€${(v / 1000).toFixed(1)}B`}
              unitFormatter={(_k, v) => `€${(v / 1000).toFixed(2)}B`}
              showZeroLine
              hideToggles
              height={220}
            />
          </div>
        </div>
      </section>

      <section id="fdi-monthly" className="mb-10 scroll-mt-20">
        <h2 className="text-lg font-semibold mb-3">
          {t("fdi_monthly_heading")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("fdi_monthly_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_sources_prefix")}
          sources={[
            {
              href: "https://www.bnb.bg/Statistics/StExternalSector/StDirectInvestments/StDIBulgaria/index.htm",
              label:
                "БНБ — Преки чуждестранни инвестиции в България (РПБ6/BPM6, monthly net flow by investment type, EUR million)",
            },
          ]}
        />
        <FdiMonthlyTile />
      </section>

      <section id="debt-emissions" className="mb-10 scroll-mt-20">
        <h2 className="text-lg font-semibold mb-3">
          {t("debt_emissions_heading")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("debt_emissions_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_sources_prefix")}
          sources={[
            {
              href: "https://www.bnb.bg/FiscalAgent/FAGSAuctions/FAAuctionResults/index.htm",
              label:
                "BNB — domestic government securities auction results (2019+)",
            },
            {
              href: "https://www.minfin.bg/bg/statistics/20",
              label:
                "Bulgarian Ministry of Finance — monthly debt bulletin (Eurobond press releases)",
            },
            {
              href: "https://www.luxse.com/issuer/Bulgaria",
              label:
                "Luxembourg Stock Exchange — Republic of Bulgaria listings",
            },
          ]}
        />
        <DebtEmissionsTable />
      </section>

      <section id="eu-funds" className="mb-10 scroll-mt-20">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_eu_funds")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_chart_eu_funds_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_source_prefix")}
          sources={[
            {
              href: "https://commission.europa.eu/strategy-and-policy/eu-budget/performance-and-reporting_en",
              label:
                "European Commission — EU budget performance & reporting (annual financial reports)",
            },
          ]}
        />
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={["euFunds", "euContribution"]}
          yAxisFormatter={(v) => `€${v}B`}
          unitFormatter={(_k, v) => `€${v.toFixed(2)}B`}
          yDomain={[0, 4]}
          height={280}
          eventMarkers={[
            {
              x: 2008.55,
              label: t("governments_chart_eu_funds_2008_marker"),
              labelPosition: "insideTopRight",
            },
          ]}
        />
      </section>
    </div>
  );
};
