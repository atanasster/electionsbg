import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Repeat, Home } from "lucide-react";
import { H1 } from "@/ux/H1";
import { SEO } from "@/ux/SEO";
import { Link } from "@/ux/Link";
import { ErrorSection } from "@/screens/components/ErrorSection";
import { useClusterPersistence } from "@/data/riskScore/useClusterPersistence";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useRegions } from "@/data/regions/useRegions";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { localDate } from "@/data/utils";
import { RiskBandBadge } from "@/screens/components/riskScore/RiskBandBadge";
import { StatCard } from "@/screens/dashboard/StatCard";
import { ElectionsBreadcrumb } from "@/screens/components/ElectionsBreadcrumb";

const stripPrefix = (s?: string) => (s ?? "").replace(/^\d+\.\s*/, "");
const HEADER_CLASS =
  "text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

// `/risk-analysis/cluster/:id` — detail page for one persistent locus: a
// geographic knot that clustered (screened elevated-or-above as a
// same-party bloc) in two or more elections. Reached from the
// "Recurring risk clusters" card and from the badge on member sections.
// A VIEW over published screening data — see useClusterPersistence.
export const RiskClusterScreen: FC = () => {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data, isLoading } = useClusterPersistence();
  const { displayNameFor, colorFor } = useCanonicalParties();
  const { findRegion } = useRegions();
  const { findMunicipality } = useMunicipalities();
  const { findSettlement } = useSettlementsInfo();

  const locus = data?.loci.find((l) => l.id === id);

  if (isLoading) return null;
  if (!locus) {
    return (
      <div className="w-full px-4 md:px-8">
        <H1>{t("risk_persistence_title")}</H1>
        <ErrorSection title={t("risk_persistence_not_found")} />
      </div>
    );
  }

  const region = findRegion(locus.oblast);
  const muni = findMunicipality(locus.obshtina);
  const settlement = findSettlement((locus.ekatte || "").split("-")[0]);
  const oblastName = isBg
    ? stripPrefix(region?.long_name || region?.name)
    : stripPrefix(region?.long_name_en || region?.name_en || region?.name);
  const muniName = isBg
    ? muni?.long_name || muni?.name
    : muni?.long_name_en || muni?.name_en || muni?.name;
  const settlementName = isBg
    ? settlement?.name
    : settlement?.name_en || settlement?.name;
  const location =
    [settlementName, muniName, oblastName]
      .filter((s, idx, arr) => !!s && arr.indexOf(s) === idx)
      .join(" · ") ||
    locus.ekatte ||
    "—";

  return (
    <div className="w-full px-4 md:px-8">
      <SEO
        title={`${location} — ${t("risk_persistence_title")}`}
        description={t("risk_persistence_detail_summary", {
          count: locus.electionCount,
          sections: locus.sectionCount,
        })}
      />
      <ElectionsBreadcrumb
        hub="analysis"
        section={{ labelKey: "risk_analysis_title", to: "/risk-analysis" }}
        current={location}
        className="mt-4 mb-1"
      />
      <H1>{location}</H1>
      <div className="flex items-center justify-center gap-2 pb-3 flex-wrap">
        <RiskBandBadge band={locus.maxBand} score={locus.maxScore} />
        <span className="text-sm text-muted-foreground">
          {t("risk_persistence_detail_summary", {
            count: locus.electionCount,
            sections: locus.sectionCount,
          })}
        </span>
      </div>

      {locus.problemNeighborhood ? (
        <div className="flex justify-center pb-3">
          <Link
            to={`/reports/section/problem_sections/${locus.problemNeighborhood.id}`}
            underline={false}
            className="inline-flex items-center gap-1.5 rounded-full border border-negative/60 bg-negative/10 px-3 py-1 text-xs font-semibold text-negative hover:bg-negative/20"
          >
            <Home className="h-3.5 w-3.5" />
            <span>
              {t("risk_persistence_problem_overlap", {
                count: locus.problemSectionCount,
                total: locus.sectionCount,
                name: isBg
                  ? locus.problemNeighborhood.nameBg
                  : locus.problemNeighborhood.nameEn,
              })}
            </span>
          </Link>
        </div>
      ) : null}

      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <StatCard
          label={
            <div className="flex items-center gap-2">
              <Repeat className="h-4 w-4" />
              <span>{t("risk_persistence_timeline_title")}</span>
            </div>
          }
        >
          <div className="mt-1 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-x-3 gap-y-1.5 items-center text-sm">
            <span className={HEADER_CLASS}>
              {t("risk_history_col_election")}
            </span>
            <span className={HEADER_CLASS}>{t("winner")}</span>
            <span className={`${HEADER_CLASS} text-right`}>
              {t("risk_clusters_col_sections")}
            </span>
            <span className={`${HEADER_CLASS} text-right`}>
              {t("risk_col_band")}
            </span>
            {locus.appearances.map((a) => {
              const color =
                (a.winnerNickName && colorFor(a.winnerNickName)) ||
                a.winnerColor ||
                "#888";
              const name = a.winnerNickName
                ? (displayNameFor(a.winnerNickName) ?? a.winnerNickName)
                : "—";
              return (
                <div className="contents" key={a.election}>
                  <span className="text-xs tabular-nums whitespace-nowrap">
                    {localDate(a.election)}
                  </span>
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate text-xs font-medium">{name}</span>
                  </div>
                  <span className="text-right text-xs font-semibold tabular-nums">
                    {a.sectionCount}
                  </span>
                  <span className="justify-self-end">
                    <RiskBandBadge
                      band={a.maxBand}
                      score={a.maxScore}
                      size="sm"
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </StatCard>

        <StatCard
          label={t("risk_persistence_sections_title", {
            count: locus.sectionCount,
          })}
        >
          <p className="text-xs text-muted-foreground mb-2">
            {t("risk_persistence_sections_hint")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {locus.sections.map((section) => (
              <Link
                key={section}
                to={`/section/${section}`}
                underline={false}
                className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs hover:bg-muted"
              >
                {section}
              </Link>
            ))}
          </div>
        </StatCard>
      </div>
    </div>
  );
};
