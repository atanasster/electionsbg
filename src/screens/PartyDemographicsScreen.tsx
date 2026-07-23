import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, Users } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Hint } from "@/ux/Hint";
import { StatCard } from "@/screens/dashboard/StatCard";
import { useDemographicCleavages } from "@/data/dashboard/useDemographicCleavages";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { METRIC_BY_KEY } from "@/screens/components/demographics/censusMetrics";
import { DemographicCleavagesPlot } from "@/screens/components/demographics/DemographicCleavagesPlot";
import { VoteDemographicScatter } from "@/screens/components/demographics/VoteDemographicScatter";

const fmtR = (r: number) => `${r > 0 ? "+" : ""}${r.toFixed(2)}`;

export const PartyDemographicsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { data: payload } = useDemographicCleavages();
  const { displayNameFor } = useCanonicalParties();
  const isBg = i18n.language === "bg";

  // Headline figures from the cleavages payload (rows are pre-sorted by spread
  // desc, so rows[0] is the most polarizing dimension). `strongest` scans every
  // party×metric cell for the single sharpest correlation.
  const kpis = useMemo(() => {
    if (!payload || payload.rows.length === 0) return undefined;
    const top = payload.rows[0];
    let best = { r: 0, metric: top.metric, partyIdx: 0 };
    for (const row of payload.rows) {
      row.rs.forEach((r, i) => {
        if (Math.abs(r) > Math.abs(best.r))
          best = { r, metric: row.metric, partyIdx: i };
      });
    }
    return { top, best };
  }, [payload]);

  const title = t("party_demographics_title");
  const metricLabel = (m: string) => {
    const def = METRIC_BY_KEY[m as keyof typeof METRIC_BY_KEY];
    return def ? t(def.i18nKey) : m;
  };
  const partyName = (p: NonNullable<typeof payload>["parties"][number]) =>
    isBg ? p.nickName : (displayNameFor(p.nickName) ?? p.nickName);

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
            <Hint text={t("party_demographics_kpi_polarizing_hint")}>
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
            <Hint text={t("party_demographics_kpi_strongest_hint")}>
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
            <Hint text={t("party_demographics_kpi_parties_hint")}>
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

      {/* Hero — the full cleavages dot plot (all census metrics × 4%+ parties). */}
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
            <DemographicCleavagesPlot payload={payload} rows={payload.rows} />
          ) : (
            <div className="text-sm text-muted-foreground py-12 text-center">
              {t("loading")}
            </div>
          )}
        </StatCard>
      </div>

      {/* Drill-down: per-municipality scatter for a chosen metric (URL-driven,
          deep-linked from the dot-plot rows via ?scatter=<metric>). */}
      <div className="mt-3">
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
