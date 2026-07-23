import { FC, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Users } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Hint } from "@/ux/Hint";
import { Link } from "@/ux/Link";
import { StatCard } from "@/screens/dashboard/StatCard";
import { useDemographicCleavages } from "@/data/dashboard/useDemographicCleavages";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import type { CensusMetric } from "@/data/census/censusTypes";
import { METRIC_BY_KEY } from "@/screens/components/demographics/censusMetrics";
import { fmtR } from "@/screens/components/demographics/demographicsFormat";
import { computeCleavageKpis } from "@/screens/components/demographics/cleavageKpis";
import { DemographicCleavagesPlot } from "@/screens/components/demographics/DemographicCleavagesPlot";
import { VoteDemographicScatter } from "@/screens/components/demographics/VoteDemographicScatter";

export const PartyDemographicsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { data: payload } = useDemographicCleavages();
  const { displayNameFor } = useCanonicalParties();
  const [, setScatterMetric] = useSearchParam("scatter", { replace: true });
  const scatterRef = useRef<HTMLDivElement>(null);
  const isBg = i18n.language === "bg";

  const kpis = useMemo(() => computeCleavageKpis(payload), [payload]);

  const title = t("party_demographics_title");
  const metricLabel = (m: CensusMetric) => {
    const def = METRIC_BY_KEY[m];
    return def ? t(def.i18nKey) : m;
  };
  const partyName = (p: NonNullable<typeof payload>["parties"][number]) =>
    isBg ? p.nickName : (displayNameFor(p.nickName) ?? p.nickName);

  // Clicking a dot-plot row drives the embedded scatter below (setting the
  // ?scatter param preserves the selected election) and scrolls it into view.
  const onMetricSelect = (metric: CensusMetric) => {
    setScatterMetric(metric);
    scatterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="pb-12">
      <SEO title={title} description={t("party_demographics_description")} />

      <div className="py-4 md:py-6">
        <H1 className="text-xl md:text-2xl font-bold text-foreground">
          {title}
        </H1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl mx-auto text-center">
          {t("party_demographics_description")}
        </p>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <StatCard
          label={
            <Hint
              text={t("party_demographics_kpi_polarizing_hint")}
              underline={false}
            >
              <span>{t("party_demographics_kpi_polarizing")}</span>
            </Hint>
          }
        >
          <div className="text-2xl md:text-3xl font-bold tabular-nums">
            {kpis ? kpis.top.spread.toFixed(2) : "—"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {kpis ? metricLabel(kpis.top.metric) : ""}
          </div>
        </StatCard>

        <StatCard
          label={
            <Hint
              text={t("party_demographics_kpi_strongest_hint")}
              underline={false}
            >
              <span>{t("party_demographics_kpi_strongest")}</span>
            </Hint>
          }
        >
          <div className="text-2xl md:text-3xl font-bold tabular-nums">
            {kpis ? fmtR(kpis.best.r) : "—"}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            {kpis && payload
              ? `${partyName(payload.parties[kpis.best.partyIdx])} · ${metricLabel(kpis.best.metric)}`
              : ""}
          </div>
        </StatCard>

        <StatCard
          label={
            <Hint
              text={t("party_demographics_kpi_parties_hint")}
              underline={false}
            >
              <span>{t("party_demographics_kpi_parties")}</span>
            </Hint>
          }
        >
          <div className="text-2xl md:text-3xl font-bold tabular-nums">
            {payload ? payload.parties.length : "—"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {t("party_demographics_kpi_parties_sub")}
          </div>
        </StatCard>
      </div>

      {/* Hero — the full cleavages dot plot (all census metrics × 4%+ parties).
          Clicking a row drives the scatter below. */}
      <div data-og="party-demographics">
        <StatCard
          label={
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span>{t("dashboard_demographic_cleavages")}</span>
            </div>
          }
        >
          {payload && payload.rows.length > 0 ? (
            <DemographicCleavagesPlot
              payload={payload}
              rows={payload.rows}
              onMetricSelect={onMetricSelect}
            />
          ) : (
            <div className="text-sm text-muted-foreground py-12 text-center">
              {t("loading")}
            </div>
          )}
        </StatCard>
      </div>

      {/* Drill-down: per-municipality scatter for the chosen metric (URL-driven
          via ?scatter=<metric>, set by clicking a dot-plot row above). */}
      <div id="scatter" ref={scatterRef} className="mt-3 scroll-mt-24">
        <StatCard
          label={
            <div className="flex items-center gap-2">
              <span>{t("party_demographics_scatter_title")}</span>
            </div>
          }
        >
          <VoteDemographicScatter />
        </StatCard>
      </div>

      <p className="text-[11px] text-muted-foreground mt-4">
        {t("party_demographics_methodology")}{" "}
        <Link
          to="/demographics"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          {t("party_demographics_census_link")}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </p>
    </div>
  );
};
