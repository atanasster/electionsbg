import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useGovernments } from "@/data/governments/useGovernments";
import { useMacro } from "@/data/macro/useMacro";
import { useObservations } from "@/data/governments/useObservations";
import {
  CabinetStrip,
  GovernmentTimeline,
} from "./components/governments/GovernmentTimeline";
import { xDomainFor } from "./components/governments/governmentTimelineUtils";
import { GovernmentTable } from "./components/governments/GovernmentTable";
import { ElectionObservations } from "./components/governments/ElectionObservations";

type ChartSource = { href: string; label: string };

const ChartSources = ({
  sources,
  prefix,
}: {
  sources: ChartSource[];
  prefix: string;
}) => (
  <p className="text-[11px] text-muted-foreground mb-3">
    {prefix}{" "}
    {sources.map((s, i) => (
      <span key={s.href}>
        {i > 0 ? " · " : null}
        <a
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {s.label}
        </a>
      </span>
    ))}
  </p>
);

export const GovernmentsScreen = () => {
  const { t, i18n } = useTranslation();
  const { data: governments } = useGovernments();
  const { data: macro } = useMacro();
  const { data: observations } = useObservations();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";

  const xDomain = useMemo<[number, number] | null>(
    () => (governments ? xDomainFor(governments) : null),
    [governments],
  );

  if (!governments) {
    return (
      <div className="w-full max-w-6xl mx-auto px-4 pb-12">
        <Title>{t("governments_title")}</Title>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 pb-12">
      <Title description={t("governments_description")}>
        {t("governments_title")}
      </Title>

      <p className="text-sm text-muted-foreground mb-6 max-w-3xl">
        {t("governments_explainer")}
      </p>

      {/* Cabinet strip aligned to the chart's plot area, rendered once at the
          top so it acts as a shared header for all three timelines below. */}
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
              href: "https://ec.europa.eu/eurostat/databrowser/view/nama_10_gdp/default/table",
              label: "Eurostat nama_10_gdp (real GDP growth)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_aind/default/table",
              label: "Eurostat prc_hicp_aind (HICP inflation)",
            },
            {
              href: "https://ec.europa.eu/eurostat/databrowser/view/une_rt_a/default/table",
              label: "Eurostat une_rt_a (unemployment rate)",
            },
          ]}
        />
        <GovernmentTimeline
          governments={governments}
          macro={macro}
          indicatorKeys={["gdpGrowth", "inflation", "unemployment"]}
          yAxisFormatter={(v) => `${v}%`}
          unitFormatter={(_k, v) => `${v.toFixed(1)}%`}
          showZeroLine
          height={360}
        />
      </section>

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

      <section className="mb-10">
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
        />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">
          {t("governments_table_heading")}
        </h2>
        <GovernmentTable governments={governments} macro={macro} />
      </section>

      {observations ? (
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3">
            {t("governments_observations_heading")}
          </h2>
          <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
            {t("governments_observations_explainer")}
          </p>
          <ElectionObservations payload={observations} />
        </section>
      ) : null}

      <p className="text-[11px] text-muted-foreground mt-6">
        {t("governments_source_prefix")}{" "}
        <a
          href="https://ec.europa.eu/eurostat/databrowser/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Eurostat
        </a>
        {" · "}
        <a
          href="https://databank.worldbank.org/source/worldwide-governance-indicators"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          World Bank WGI
        </a>
        {" · "}
        <a
          href="https://www.transparency.org/en/cpi"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Transparency International CPI
        </a>
        {" · "}
        <a
          href="https://europa.eu/eurobarometer/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {lang === "bg" ? "Евробарометър" : "Eurobarometer"}
        </a>
        {" · "}
        <a
          href="https://www.osce.org/odihr/elections/bulgaria"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          OSCE/ODIHR
        </a>
        {" · "}
        {lang === "bg"
          ? "правителства от Уикипедия"
          : "cabinets from Wikipedia"}
      </p>
    </div>
  );
};
