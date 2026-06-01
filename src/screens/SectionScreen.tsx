import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ShieldAlert,
  Repeat,
  Video,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { useSectionsVotes } from "@/data/sections/useSectionsVotes";
import { countVideoUrl, protocolScanUrl } from "@/data/sections/auditLinks";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useRegions } from "@/data/regions/useRegions";
import { useProblemSections } from "@/data/reports/useProblemSections";
import { useClusterPersistence } from "@/data/riskScore/useClusterPersistence";
import { useElectionContext } from "@/data/ElectionContext";
import { SEO } from "@/ux/SEO";
import { Link } from "@/ux/Link";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { SectionDashboardCards } from "./dashboard/SectionDashboardCards";
import { SectionRiskBadge } from "./components/riskScore/SectionRiskBadge";

const AuditChip: FC<{
  href: string;
  title: string;
  icon: LucideIcon;
  label: string;
}> = ({ href, title, icon: Icon, label }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    title={title}
    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-semibold text-foreground hover:bg-muted"
  >
    <Icon className="h-3.5 w-3.5" />
    <span>{label}</span>
  </a>
);

export const SectionScreen = () => {
  const { id: sectionCode } = useParams();
  const { t, i18n } = useTranslation();
  const { selected } = useElectionContext();
  const section = useSectionsVotes(sectionCode);
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();
  const { data: problemSections } = useProblemSections();
  const { data: clusterPersistence } = useClusterPersistence();

  if (!sectionCode) return null;

  const videoUrl = countVideoUrl(selected, sectionCode);
  const scanUrl = protocolScanUrl(selected, sectionCode);

  const problemNeighborhood = problemSections?.neighborhoods.find((n) =>
    n.sections.some((s) => s.section === sectionCode),
  );
  // The persistent locus (if any) this section is a member of — clustered
  // with adjacent same-party sections in two or more elections.
  const persistentLocus = clusterPersistence?.loci.find((l) =>
    l.sections.includes(sectionCode),
  );

  const settlement = section ? findSettlement(section.ekatte) : undefined;
  const region = section ? findRegion(section.oblast) : undefined;
  const municipality = section ? findMunicipality(section.obshtina) : undefined;

  const regionName = region
    ? i18n.language === "bg"
      ? region.long_name || region.name
      : region.long_name_en || region.name_en
    : "";
  const municipalityName = municipality
    ? i18n.language === "bg"
      ? municipality.name
      : municipality.name_en
    : "";
  const settlementName = settlement
    ? i18n.language === "bg"
      ? settlement.name
      : settlement.name_en
    : "";
  const sectionLabel = `${t("section")} ${sectionCode}`;
  const titleStr = [regionName, municipalityName, settlementName, sectionLabel]
    .filter(Boolean)
    .join(" / ");

  // Audit chips + street address live under the breadcrumb in the unified
  // header, mirroring the cross-link "extra" slot the local pages use.
  const headerExtra = (
    <div className="space-y-2">
      {section?.address ? (
        <p className="text-sm text-muted-foreground">{section.address}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {problemNeighborhood ? (
          <Link
            to={`/reports/section/problem_sections/${problemNeighborhood.id}`}
            underline={false}
            className="inline-flex items-center gap-1.5 rounded-full border border-negative/60 bg-negative/10 px-3 py-1 text-xs font-semibold text-negative hover:bg-negative/20"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>{t("problem_section_badge")}</span>
            <span className="text-muted-foreground font-normal">
              ·{" "}
              {i18n.language === "bg"
                ? problemNeighborhood.name_bg
                : problemNeighborhood.name_en}
            </span>
          </Link>
        ) : null}
        {persistentLocus ? (
          <Link
            to={`/risk-analysis/cluster/${persistentLocus.id}`}
            underline={false}
            className="inline-flex items-center gap-1.5 rounded-full border border-negative/60 bg-negative/10 px-3 py-1 text-xs font-semibold text-negative hover:bg-negative/20"
          >
            <Repeat className="h-3.5 w-3.5" />
            <span>{t("risk_persistence_section_badge")}</span>
            <span className="text-muted-foreground font-normal">
              · {persistentLocus.electionCount}×
            </span>
          </Link>
        ) : null}
        <SectionRiskBadge sectionCode={sectionCode} />
        {videoUrl ? (
          <AuditChip
            href={videoUrl}
            title={t("count_video_badge_title")}
            icon={Video}
            label={t("count_video_badge")}
          />
        ) : null}
        {scanUrl ? (
          <AuditChip
            href={scanUrl}
            title={t("protocol_scan_badge_title")}
            icon={FileText}
            label={t("protocol_scan_badge")}
          />
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      <SEO
        title={`${t("section")} ${sectionCode}${settlementName ? " · " + settlementName : ""}`}
        description={titleStr}
      />
      <PlaceHeader
        active="parliamentary"
        level="section"
        sectionCode={sectionCode}
        ekatte={section?.ekatte}
        obshtina={section?.obshtina}
        oblast={section?.oblast}
        extra={headerExtra}
        className="my-4"
      />
      <SectionDashboardCards sectionCode={sectionCode} />
    </>
  );
};
