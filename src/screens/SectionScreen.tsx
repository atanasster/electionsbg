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
import { useProblemSectionMembership } from "@/data/reports/useProblemSections";
import { useClusterMembership } from "@/data/riskScore/useClusterPersistence";
import { useElectionContext } from "@/data/ElectionContext";
import { SEO } from "@/ux/SEO";
import { Link } from "@/ux/Link";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { SectionDashboardCards } from "./dashboard/SectionDashboardCards";
import { ElectionSurfaceBoundary } from "@/screens/elections/ElectionSurfaceBoundary";
import { ElectionResultsShell } from "@/screens/elections/ElectionResultsShell";
import { ElectionScopeBar } from "@/screens/elections/ElectionScopeBar";
import { ElectionSurfaceSkeleton } from "@/screens/elections/ElectionSurfaceSkeleton";
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
  // Slim section→membership reverse-indexes — the section page only needs to
  // know whether THIS section sits in a problem neighborhood / persistent
  // locus to render a badge, not the full national reports.
  const problemNeighborhood = useProblemSectionMembership(sectionCode);
  // The persistent locus (if any) this section is a member of — clustered
  // with adjacent same-party sections in two or more elections.
  const persistentLocus = useClusterMembership(sectionCode);

  if (!sectionCode) return null;

  const videoUrl = countVideoUrl(selected, sectionCode);
  const scanUrl = protocolScanUrl(selected, sectionCode);

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
      {/* ⚠ THE LINE IS RESERVED, NOT CONDITIONAL. The address arrives with the section JSON,
          so rendering it only once present grows this block from 26px to 54px and drops the
          whole page below it — measured on the built site with slow JSON, the second-largest
          shift on the route. `min-h-5` holds exactly one line of `text-sm`, which is what all
          but the longest addresses occupy; an empty reserved line looks like the loading state
          it is, where a jump looks like the page reflowing under the reader's eye. */}
      <p className="min-h-5 text-sm text-muted-foreground">
        {section?.address ?? ""}
      </p>
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
        scope={<ElectionScopeBar cycle={selected} status="final" />}
      />
      {/* ⚠ NO MAP AND NO DIGEST HERE, and both are rules rather than omissions. The section
          descriptor declares `maps: []` — one polling station has no geography to answer a
          question about — so the canvas draws its ranked result alone; and `buildPlaceDigest`
          refuses a section outright, because three of the four views do not resolve at this
          level and a one-cell digest is chrome (§4.1, §Phase 6 items 3 and 5b).
          `withMap={false}` on the skeleton for the same reason: reserving a 320px box that
          nothing ever fills is the layout shift in the other direction. */}
      <ElectionSurfaceBoundary
        kind="parliamentary"
        level="section"
        cycle={selected}
        id={sectionCode}
        skeleton={<ElectionSurfaceSkeleton facts={4} withMap={false} />}
        fallback={null}
      >
        {(s) => (
          <ElectionResultsShell
            surface={s}
            scope="header"
            currentView="parliamentary"
          />
        )}
      </ElectionSurfaceBoundary>
      <SectionDashboardCards sectionCode={sectionCode} />
    </>
  );
};
