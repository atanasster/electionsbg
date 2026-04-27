import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useSectionsVotes } from "@/data/sections/useSectionsVotes";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useRegions } from "@/data/regions/useRegions";
import { useProblemSections } from "@/data/reports/useProblemSections";
import { SEO } from "@/ux/SEO";
import { H1 } from "@/ux/H1";
import { Link } from "@/ux/Link";
import { SectionDashboardCards } from "./dashboard/SectionDashboardCards";

export const SectionScreen = () => {
  const { id: sectionCode } = useParams();
  const { t, i18n } = useTranslation();
  const section = useSectionsVotes(sectionCode);
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();
  const { findRegion } = useRegions();
  const { data: problemSections } = useProblemSections();

  if (!sectionCode) return null;

  const problemNeighborhood = problemSections?.neighborhoods.find((n) =>
    n.sections.some((s) => s.section === sectionCode),
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

  const title = (
    <>
      {region ? (
        <Link to={`/municipality/${region.oblast}`}>{regionName}</Link>
      ) : null}
      {region && municipality ? " / " : null}
      {municipality ? (
        <Link to={`/settlement/${municipality.obshtina}`}>
          {municipalityName}
        </Link>
      ) : null}
      {(region || municipality) && settlement ? " / " : null}
      {settlement ? (
        <Link to={`/sections/${settlement.ekatte}`}>{settlementName}</Link>
      ) : null}
      {region || municipality || settlement ? " / " : null}
      {sectionLabel}
    </>
  );
  const titleStr = [regionName, municipalityName, settlementName, sectionLabel]
    .filter(Boolean)
    .join(" / ");
  const address = section?.address ? `, ${section.address}` : "";
  const subtitle = section ? `${section.settlement}${address}` : "";

  return (
    <>
      <SEO
        title={`${t("section")} ${sectionCode}${settlementName ? " · " + settlementName : ""}`}
        description={titleStr}
      />
      <H1>{title}</H1>
      {subtitle ? (
        <p className="text-center text-sm text-muted-foreground -mt-2 mb-2">
          {subtitle}
        </p>
      ) : null}
      {problemNeighborhood ? (
        <div className="flex justify-center mb-2">
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
        </div>
      ) : null}
      <SectionDashboardCards sectionCode={sectionCode} />
    </>
  );
};
