// /indicators/economy — Economy headline, Inflation breakdown, Sentiment.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useGovernments } from "@/data/governments/useGovernments";
import { useMacro } from "@/data/macro/useMacro";
import { useMacroPeers } from "@/data/macro/useMacroPeers";
import { useCompareToggle } from "@/data/macro/useCompareToggle";
import {
  CabinetStrip,
  GovernmentTimeline,
  initialIndicatorToggle,
  type IndicatorSpec,
  type IndicatorToggle,
  type PeerOverlay,
} from "@/screens/components/governments/GovernmentTimeline";
import type { MacroIndicatorKey } from "@/data/macro/useMacro";
import { InflationBreakdownChart } from "@/screens/components/governments/InflationBreakdownChart";
import { xDomainFor } from "@/screens/components/governments/governmentTimelineUtils";
import { PeerSnapshotTable } from "@/screens/components/macro/PeerSnapshotTable";
import { CompareToggleButton } from "@/screens/components/macro/CompareToggleButton";
import { IndicatorsNav } from "./indicatorsNav";
import { ChartSources } from "./indicatorsShared";

const ECONOMY_INDICATOR_SPEC: IndicatorSpec = [
  {
    labelKey: "governments_chart_group_headline",
    keys: [
      "gdpGrowth",
      "inflation",
      "unemployment",
      "labourIncome",
    ] as MacroIndicatorKey[],
  },
  {
    labelKey: "governments_chart_group_activity",
    keys: ["industrialProd", "retailVolume"] as MacroIndicatorKey[],
  },
];

const ECONOMY_DEFAULT_ENABLED: MacroIndicatorKey[] = [
  "gdpGrowth",
  "inflation",
  "unemployment",
];

export const IndicatorsEconomyScreen = () => {
  const { t, i18n } = useTranslation();
  const { data: governments } = useGovernments();
  const { data: macro } = useMacro();
  const { data: peers } = useMacroPeers();
  const [compare, toggleCompare] = useCompareToggle();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";

  const peerOverlay = useMemo<PeerOverlay | undefined>(() => {
    if (!peers?.indicators) return undefined;
    return peers.indicators as PeerOverlay;
  }, [peers]);

  const [economyEnabled, setEconomyEnabled] = useState<IndicatorToggle>(() =>
    initialIndicatorToggle(ECONOMY_INDICATOR_SPEC, ECONOMY_DEFAULT_ENABLED),
  );

  const xDomain = useMemo<[number, number] | null>(
    () => (governments ? xDomainFor(governments) : null),
    [governments],
  );

  if (!governments) {
    return (
      <div className="pb-12">
        <Title>{t("indicators_economy_title")}</Title>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <Title description={t("indicators_economy_description")}>
        {t("indicators_economy_title")}
      </Title>

      <IndicatorsNav />

      <div className="mb-4 flex justify-end">
        <CompareToggleButton enabled={compare} onToggle={toggleCompare} />
      </div>

      {xDomain ? (
        <CabinetStrip governments={governments} xDomain={xDomain} lang={lang} />
      ) : null}

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_economy")}
        </h2>
        <ChartSources
          prefix={t("governments_chart_sources_prefix")}
          sources={[
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/namq_10_gdp/default/table",
              label: "Eurostat namq_10_gdp (real GDP growth, quarterly)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table",
              label:
                "Eurostat prc_hicp_minr (HICP inflation, monthly→quarterly mean)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/une_rt_q/default/table",
              label: "Eurostat une_rt_q (unemployment rate, quarterly)",
            },
          ]}
        />
        {compare && (
          <PeerSnapshotTable
            rows={[
              { indicatorKey: "gdpGrowth" },
              { indicatorKey: "inflation" },
              { indicatorKey: "unemployment" },
            ].filter(
              (r) => economyEnabled[r.indicatorKey as MacroIndicatorKey],
            )}
          />
        )}
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={ECONOMY_INDICATOR_SPEC}
          enabled={economyEnabled}
          onEnabledChange={setEconomyEnabled}
          yAxisFormatter={(v) => `${v}`}
          unitFormatter={(k, v) =>
            k === "industrialProd" || k === "retailVolume"
              ? v.toFixed(1)
              : `${v.toFixed(1)}%`
          }
          showZeroLine
          height={360}
          peerOverlay={peerOverlay}
          peerCompareEnabled={compare}
        />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_inflation_breakdown")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_chart_inflation_breakdown_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_source_prefix")}
          sources={[
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table",
              label:
                "Eurostat prc_hicp_minr (HICP by ECOICOP, monthly→quarterly mean)",
            },
          ]}
        />
        <InflationBreakdownChart
          governments={governments}
          macro={macro}
          height={340}
        />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_sentiment")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_chart_sentiment_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_source_prefix")}
          sources={[
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/ei_bssi_m_r2/default/table",
              label:
                "Eurostat ei_bssi_m_r2 (consumer confidence + Economic Sentiment Indicator)",
            },
          ]}
        />
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={["consumerConfidence", "economicSentiment"]}
          yAxisFormatter={(v) => v.toFixed(0)}
          unitFormatter={(_k, v) => v.toFixed(1)}
          showZeroLine
          height={300}
        />
      </section>
    </div>
  );
};
