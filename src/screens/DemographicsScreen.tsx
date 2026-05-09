import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useCensus } from "@/data/census/useCensus";
import { CountryBreakdown } from "./components/demographics/CountryBreakdown";
import { OblastDemographicsTable } from "./components/demographics/OblastDemographicsTable";
import { CensusChoroplethMap } from "./components/demographics/CensusChoroplethMap";
import { MetricSelector } from "./components/demographics/MetricSelector";
import { VoteDemographicScatter } from "./components/demographics/VoteDemographicScatter";
import { MapLayout } from "@/layout/dataview/MapLayout";
import { useSearchParam } from "./utils/useSearchParam";
import { CENSUS_METRICS } from "./components/demographics/censusMetrics";
import type { CensusMetric } from "@/data/census/censusTypes";

const DEFAULT_MAP_METRIC: CensusMetric = "eduSecondary";
const VALID_METRICS = new Set<CensusMetric>(CENSUS_METRICS.map((m) => m.key));

export const DemographicsScreen = () => {
  const { t, i18n } = useTranslation();
  const { data: census } = useCensus();
  const [metricParam, setMetricParam] = useSearchParam("metric", {
    replace: true,
  });
  const mapMetric: CensusMetric =
    metricParam && VALID_METRICS.has(metricParam as CensusMetric)
      ? (metricParam as CensusMetric)
      : DEFAULT_MAP_METRIC;
  const setMapMetric = useCallback(
    (m: CensusMetric) => {
      setMetricParam(m === DEFAULT_MAP_METRIC ? undefined : m);
    },
    [setMetricParam],
  );
  const lang = i18n.language;

  if (!census) {
    return (
      <div className="w-full max-w-6xl mx-auto px-4 pb-12">
        <Title>{t("demographics_title")}</Title>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 pb-12">
      <Title description={t("demographics_description")}>
        {t("demographics_title")}
      </Title>

      <p className="text-sm text-muted-foreground mb-6 max-w-3xl">
        {t("demographics_explainer")}
      </p>

      <section className="mb-12">
        <h2 className="text-lg font-semibold mb-3">
          {t("census_country_heading")}
        </h2>
        <div className="text-sm text-muted-foreground mb-4">
          {t("census_country_population", {
            count: census.country.population,
            formatted: census.country.population.toLocaleString(
              lang === "bg" ? "bg-BG" : "en-GB",
            ),
          })}
        </div>
        <CountryBreakdown entity={census.country} />
      </section>

      <section className="mb-12">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <h2 className="text-lg font-semibold">{t("census_map_heading")}</h2>
          <MetricSelector value={mapMetric} onChange={setMapMetric} />
        </div>
        <MapLayout>
          {(size) => <CensusChoroplethMap metric={mapMetric} size={size} />}
        </MapLayout>
      </section>

      <section className="mb-12">
        <h2 className="text-lg font-semibold mb-3">
          {t("census_crosstab_heading")}
        </h2>
        <p className="text-sm text-muted-foreground mb-4 max-w-3xl">
          {t("census_crosstab_explainer")}
        </p>
        <VoteDemographicScatter />
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3">
          {t("census_oblast_table_heading")}
        </h2>
        <OblastDemographicsTable
          oblasts={census.oblasts}
          municipalities={census.municipalities}
        />
      </section>

      <p className="text-[11px] text-muted-foreground mt-4">
        {t("census_source_prefix")}{" "}
        <a
          href={census.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {census.source}
        </a>
        {" · "}
        {t("census_reference_date")}: {census.censusDate}
      </p>
    </div>
  );
};
