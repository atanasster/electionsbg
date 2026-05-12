import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Building2,
  Cpu,
  LineChart,
  MapPin,
  ShieldAlert,
  Sigma,
  Target,
} from "lucide-react";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Link } from "@/ux/Link";
import { useElectionContext } from "@/data/ElectionContext";
import { useNationalSummary } from "@/data/dashboard/useNationalSummary";
import { useProblemSectionsStats } from "@/data/reports/useProblemSectionsStats";
import { localDate } from "@/data/utils";
import { MethodologyCallout } from "@/screens/components/MethodologyCallout";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { FlashMemoryTile } from "@/screens/dashboard/FlashMemoryTile";
import { SuspiciousSectionsTile } from "@/screens/dashboard/SuspiciousSectionsTile";
import { ProblemSectionsTile } from "@/screens/dashboard/ProblemSectionsTile";
import { ProblemVotesByPartyTile } from "@/screens/dashboard/ProblemVotesByPartyTile";
import { RiskScoreTopCard } from "@/screens/components/riskAnalysis/RiskScoreTopCard";
import { BenfordRiskCard } from "@/screens/components/riskAnalysis/BenfordRiskCard";
import { RelatedAnalysesCard } from "@/screens/components/riskAnalysis/RelatedAnalysesCard";
import { CompositeIndexHero } from "@/screens/components/riskAnalysis/CompositeIndexHero";
import { PollsExpectationCard } from "@/screens/components/riskAnalysis/PollsExpectationCard";

const HistoricalTrendsTile = lazy(() =>
  import("@/screens/dashboard/HistoricalTrendsTile").then((m) => ({
    default: m.HistoricalTrendsTile,
  })),
);

// `/risk-analysis` — election-scoped hub that consolidates every screening
// signal we publish: section-level risk score, Benford 2BL fingerprint,
// machine flash-memory drift, suspicious settlements, and Roma-махала
// dashboards. Each tile is a summary that links into the underlying
// detail screen — the page is an INDEX, not a duplicate of those
// pages. The composite hero (Индекс на изборния риск) is intentionally
// not here yet — it's tracked as a separate methodology decision.
export const RiskAnalysisScreen = () => {
  const { t } = useTranslation();
  const { selected, electionStats } = useElectionContext();
  const { data: national } = useNationalSummary();
  const { data: problemSectionsStats } = useProblemSectionsStats();

  const hasFlash = !!electionStats?.hasSuemg;
  const parties = national?.parties ?? [];

  return (
    <div className="pb-12">
      <SEO
        title={t("risk_analysis_title")}
        description={t("risk_analysis_description")}
      />
      <div className="py-4 md:py-6">
        <H1 className="text-xl md:text-2xl font-bold text-foreground">
          {t("risk_analysis_title")}
        </H1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl mx-auto text-center">
          {t("risk_analysis_description")}
        </p>
        <p className="text-[11px] text-muted-foreground mt-1 text-center">
          {t("risk_analysis_election_for", { date: localDate(selected) })}
        </p>
      </div>

      <MethodologyCallout
        variant="disputed"
        title={t("risk_analysis_caveat_title")}
        className="mb-4"
      >
        {t("risk_analysis_caveat_body")}{" "}
        <Link
          to="/risk-analysis/methodology"
          className="text-primary hover:underline"
          underline={false}
        >
          {t("risk_read_full_methodology")} →
        </Link>
      </MethodologyCallout>

      <div className="mb-4">
        <CompositeIndexHero />
      </div>

      <DashboardSection
        id="anomalies"
        title={t("risk_analysis_section_sections")}
        icon={ShieldAlert}
      >
        <RiskScoreTopCard />
      </DashboardSection>

      <DashboardSection
        id="anomalies"
        title={t("risk_analysis_section_benford")}
        icon={Sigma}
      >
        <BenfordRiskCard />
      </DashboardSection>

      {hasFlash ? (
        <DashboardSection
          id="anomalies"
          title={t("risk_analysis_section_flash")}
          icon={Cpu}
        >
          <FlashMemoryTile parties={parties} topN={20} />
        </DashboardSection>
      ) : null}

      <DashboardSection
        id="anomalies"
        title={t("risk_analysis_section_suspicious")}
        icon={MapPin}
      >
        <SuspiciousSectionsTile parties={parties} />
      </DashboardSection>

      <DashboardSection
        id="anomalies"
        title={t("risk_analysis_section_polls")}
        icon={Target}
      >
        <PollsExpectationCard />
      </DashboardSection>

      <DashboardSection
        id="neighborhoods"
        title={t("risk_analysis_section_neighborhoods")}
        icon={Building2}
      >
        <ProblemSectionsTile parties={parties} />
        <ProblemVotesByPartyTile />
      </DashboardSection>

      {problemSectionsStats?.length ? (
        <DashboardSection
          id="neighborhoods"
          title={t("risk_analysis_section_history")}
          icon={LineChart}
        >
          <Suspense fallback={null}>
            <HistoricalTrendsTile
              stats={problemSectionsStats}
              seeDetailsTo="/reports/section/problem_sections"
            />
          </Suspense>
        </DashboardSection>
      ) : null}

      <DashboardSection
        id="anomalies"
        title={t("risk_analysis_section_related")}
        icon={AlertTriangle}
      >
        <RelatedAnalysesCard />
      </DashboardSection>
    </div>
  );
};
