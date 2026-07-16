import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { useCensus } from "@/data/census/useCensus";
import { CountryBreakdown } from "./components/demographics/CountryBreakdown";
import { CensusChoroplethMap } from "./components/demographics/CensusChoroplethMap";
import { MetricSelector } from "./components/demographics/MetricSelector";
import { VoteDemographicScatter } from "./components/demographics/VoteDemographicScatter";
import { RegionalChoroplethMap } from "./components/regional/RegionalChoroplethMap";
import { RegionalIndicatorSelector } from "./components/regional/RegionalIndicatorSelector";
import { IndicatorsChoroplethMap } from "./components/indicators/IndicatorsChoroplethMap";
import { IndicatorsSelector } from "./components/indicators/IndicatorsSelector";
import { MapLayout } from "@/layout/dataview/MapLayout";
import { useSearchParam } from "./utils/useSearchParam";
import { CENSUS_METRICS } from "./components/demographics/censusMetrics";
import type { CensusMetric } from "@/data/census/censusTypes";
import type { RegionalIndicatorKey } from "@/data/regional/useRegional";
import type { IndicatorId } from "@/data/indicators/useIndicators";

const DEFAULT_MAP_METRIC: CensusMetric = "eduSecondary";
const VALID_METRICS = new Set<CensusMetric>(CENSUS_METRICS.map((m) => m.key));
const DEFAULT_REGIONAL_INDICATOR: RegionalIndicatorKey = "gdpPerCapita";
// Every RegionalIndicatorKey the selector offers must be a valid URL param —
// otherwise picking it sets ?regional=… but the validation below rejects it and
// snaps the map back to GDP. (Previously only 4 keys were listed, silently
// breaking the other selectable indicators.)
const VALID_REGIONAL_INDICATORS = new Set<RegionalIndicatorKey>([
  "gdpPerCapita",
  "population",
  "netMigration",
  "ltUnemployment",
  "theftRate",
  "enterpriseDensity",
  "fdiPerCapita",
  "museumVisitsPer1000",
  "hospitalBedsPer1000",
  "deathRatePer1000",
]);
const DEFAULT_INDICATOR: IndicatorId = "unemployment";
const VALID_INDICATORS = new Set<IndicatorId>([
  "unemployment",
  "dzi",
  "populationChange",
  "naturalIncrease",
  "netMigration",
]);

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
  const [regionalParam, setRegionalParam] = useSearchParam("regional", {
    replace: true,
  });
  const regionalIndicator: RegionalIndicatorKey =
    regionalParam &&
    VALID_REGIONAL_INDICATORS.has(regionalParam as RegionalIndicatorKey)
      ? (regionalParam as RegionalIndicatorKey)
      : DEFAULT_REGIONAL_INDICATOR;
  const setRegionalIndicator = useCallback(
    (k: RegionalIndicatorKey) => {
      setRegionalParam(k === DEFAULT_REGIONAL_INDICATOR ? undefined : k);
    },
    [setRegionalParam],
  );
  const [indicatorParam, setIndicatorParam] = useSearchParam("indicator", {
    replace: true,
  });
  const indicator: IndicatorId =
    indicatorParam && VALID_INDICATORS.has(indicatorParam as IndicatorId)
      ? (indicatorParam as IndicatorId)
      : DEFAULT_INDICATOR;
  const setIndicator = useCallback(
    (k: IndicatorId) => {
      setIndicatorParam(k === DEFAULT_INDICATOR ? undefined : k);
    },
    [setIndicatorParam],
  );
  const lang = i18n.language;

  if (!census) {
    return (
      <div className="pb-12">
        <Title>{t("demographics_title")}</Title>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <Title description={t("demographics_description")}>
        {t("demographics_title")}
      </Title>
      <GovernanceBreadcrumb
        sectionKey="demographics_title"
        sectionTo="/demographics"
        className="mt-5"
      />

      <p className="text-sm text-muted-foreground mb-6 max-w-3xl mx-auto text-center">
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

      <section id="regional" className="mb-12 scroll-mt-24">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
          <h2 className="text-lg font-semibold">{t("regional_map_heading")}</h2>
          <RegionalIndicatorSelector
            value={regionalIndicator}
            onChange={setRegionalIndicator}
          />
        </div>
        <p className="text-sm text-muted-foreground mb-4 max-w-3xl">
          {t("regional_map_explainer")}
        </p>
        <MapLayout>
          {(size) => (
            <RegionalChoroplethMap indicator={regionalIndicator} size={size} />
          )}
        </MapLayout>
      </section>

      <section id="indicators" className="mb-12 scroll-mt-24">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
          <h2 className="text-lg font-semibold">
            {t("indicators_map_heading")}
          </h2>
          <IndicatorsSelector value={indicator} onChange={setIndicator} />
        </div>
        <p className="text-sm text-muted-foreground mb-4 max-w-3xl">
          {t("indicators_map_explainer")}
        </p>
        <MapLayout>
          {(size) => (
            <IndicatorsChoroplethMap indicator={indicator} size={size} />
          )}
        </MapLayout>
      </section>

      <section id="scatter" className="mb-12 scroll-mt-24">
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            to="/demographics/regions"
            className="group flex items-center justify-between rounded-xl border bg-card p-4 shadow-sm hover:bg-muted transition-colors"
          >
            <div>
              <div className="font-semibold">
                {t("demographics_regions_title")}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t("census_level_oblast", { count: census.oblasts.length })}
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <Link
            to="/demographics/municipalities"
            className="group flex items-center justify-between rounded-xl border bg-card p-4 shadow-sm hover:bg-muted transition-colors"
          >
            <div>
              <div className="font-semibold">
                {t("demographics_municipalities_title")}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t("census_level_obshtina", {
                  count: census.municipalities.length,
                })}
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
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
