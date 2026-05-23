// /indicators/governance — CPI, WGI, Trust in institutions.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useGovernments } from "@/data/governments/useGovernments";
import { useMacro } from "@/data/macro/useMacro";
import {
  CabinetStrip,
  GovernmentTimeline,
} from "@/screens/components/governments/GovernmentTimeline";
import { xDomainFor } from "@/screens/components/governments/governmentTimelineUtils";
import { IndicatorsNav } from "./indicatorsNav";
import { ChartSources } from "./indicatorsShared";

export const IndicatorsGovernanceScreen = () => {
  const { t, i18n } = useTranslation();
  const { data: governments } = useGovernments();
  const { data: macro } = useMacro();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";

  const xDomain = useMemo<[number, number] | null>(
    () => (governments ? xDomainFor(governments) : null),
    [governments],
  );

  if (!governments) {
    return (
      <div className="pb-12">
        <Title>{t("indicators_governance_title")}</Title>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <Title description={t("indicators_governance_description")}>
        {t("indicators_governance_title")}
      </Title>

      <IndicatorsNav />

      {xDomain ? (
        <CabinetStrip governments={governments} xDomain={xDomain} lang={lang} />
      ) : null}

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_cpi")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_chart_cpi_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_source_prefix")}
          sources={[
            {
              href: "https://www.transparency.org/en/countries/bulgaria",
              label: "Transparency International — CPI, Bulgaria",
            },
          ]}
        />
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={["cpi"]}
          yAxisFormatter={(v) => `${v}`}
          unitFormatter={(_k, v) => `${v.toFixed(0)}/100`}
          yDomain={[30, 60]}
          height={240}
        />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_wgi")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_chart_wgi_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_source_prefix")}
          sources={[
            {
              href: "https://databank.worldbank.org/source/worldwide-governance-indicators",
              label:
                "World Bank — Worldwide Governance Indicators (Rule of Law, Control of Corruption, Government Effectiveness)",
            },
          ]}
        />
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={[
            "wgiRuleOfLaw",
            "wgiControlOfCorruption",
            "wgiGovEffectiveness",
          ]}
          yAxisFormatter={(v) => v.toFixed(1)}
          unitFormatter={(_k, v) => v.toFixed(2)}
          yDomain={[-0.5, 0.7]}
          showZeroLine
          height={280}
        />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_chart_trust")}
        </h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("governments_chart_trust_explainer")}
        </p>
        <ChartSources
          prefix={t("governments_chart_source_prefix")}
          sources={[
            {
              href: "https://europa.eu/eurobarometer/surveys/browse/all/series/4961",
              label:
                "Standard Eurobarometer — annual mean of spring & autumn waves (Bulgaria)",
            },
          ]}
        />
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={["trustParliament", "trustGovernment", "trustEu"]}
          yAxisFormatter={(v) => `${v}%`}
          unitFormatter={(_k, v) => `${v.toFixed(0)}%`}
          yDomain={[0, 70]}
          height={300}
        />
      </section>
    </div>
  );
};
