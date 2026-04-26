import { FC, ReactNode, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ExternalLink,
  MapPin,
  MemoryStick,
  RotateCcwSquare,
  UsersRound,
  Vote,
} from "lucide-react";
import { MapLayout } from "@/layout/dataview/MapLayout";
import { IconTabs } from "@/screens/IconTabs";
import { SectionsMap } from "@/screens/components/sections/SectionsMap";
import { SectionsList } from "@/screens/components/sections/SectionsList";
import { PartyVotesTable } from "@/screens/components/PartyVotesTable";
import { PartySuemgTable } from "@/screens/components/PartySuemgTable";
import { PartyRecountTable } from "@/screens/components/PartyRecountTable";
import { ProtocolSummary } from "@/screens/components/protocols/ProtocolSummary";
import { RecountCards } from "@/screens/components/protocols/RecountCards";
import { Caption } from "@/ux/Caption";
import { H1 } from "@/ux/H1";
import { SEO } from "@/ux/SEO";
import { ErrorSection } from "@/screens/components/ErrorSection";
import { useProblemSections } from "@/data/reports/useProblemSections";
import { useElectionContext } from "@/data/ElectionContext";
import { aggregateSections } from "@/data/reports/aggregateSections";

const dataViews = ["sections", "map", "parties", "recount", "suemg"] as const;
type DataViewType = (typeof dataViews)[number];

const DataTypeIcons: Record<DataViewType, ReactNode> = {
  sections: <Vote />,
  map: <MapPin />,
  parties: <UsersRound />,
  recount: <RotateCcwSquare />,
  suemg: <MemoryStick />,
};

export const ProblemSectionDetail: FC = () => {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data, isLoading } = useProblemSections();
  const { electionStats } = useElectionContext();

  const neighborhood = useMemo(
    () => data?.neighborhoods.find((n) => n.id === id),
    [data, id],
  );

  const aggregate = useMemo(() => {
    if (!neighborhood?.sections.length) return undefined;
    return aggregateSections(neighborhood.sections);
  }, [neighborhood]);

  const excluded: { exclude: DataViewType[]; replace: DataViewType } = {
    exclude: [],
    replace: "sections",
  };
  if (!electionStats?.hasRecount) excluded.exclude.push("recount");
  if (!electionStats?.hasSuemg) excluded.exclude.push("suemg");
  const hasCoords = neighborhood?.sections.some(
    (s) => typeof s.longitude === "number" && typeof s.latitude === "number",
  );
  if (!hasCoords) excluded.exclude.push("map");

  if (isLoading) return null;

  if (!neighborhood) {
    return (
      <div className="w-full px-4 md:px-8">
        <H1>{t("problem_sections")}</H1>
        <ErrorSection title={t("problem_sections_not_available")} />
      </div>
    );
  }

  const name = isBg ? neighborhood.name_bg : neighborhood.name_en;
  const city = isBg ? neighborhood.city_bg : neighborhood.city_en;
  const title = `${name} · ${city}`;

  return (
    <div className="w-full">
      <SEO
        title={`${name} — ${t("problem_sections")}`}
        description={`${name}, ${city}: ${t("problem_sections_description")}`}
        keywords={[
          name,
          city,
          "roma",
          "vote buying",
          "problem sections",
          "купен вот",
        ]}
      />
      <div className="px-4 md:px-8">
        <H1>{title}</H1>
        <div className="flex items-center justify-center gap-3 pb-4 text-sm text-muted-foreground">
          <span>
            {neighborhood.sections.length} {t("dashboard_sections")}
          </span>
          <a
            href={neighborhood.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            {t("source")} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
      {aggregate && (
        <ProtocolSummary
          results={aggregate.results}
          original={aggregate.original}
        >
          <Caption>{title}</Caption>
        </ProtocolSummary>
      )}
      {aggregate?.original && (
        <RecountCards
          results={aggregate.results}
          original={aggregate.original}
        />
      )}
      <IconTabs<DataViewType>
        title={title}
        tabs={dataViews}
        icons={DataTypeIcons}
        excluded={excluded}
        storageKey="problem_section_view"
      >
        {(view) => {
          if (view === "sections")
            return (
              <>
                <Caption className="py-8">{title}</Caption>
                <SectionsList sections={neighborhood.sections} title={name} />
              </>
            );
          if (view === "map")
            return (
              <MapLayout>
                {(size) => (
                  <SectionsMap
                    sections={neighborhood.sections}
                    size={size}
                    markerVariant="problem"
                    tooltipBadge={t("problem_section_badge")}
                  />
                )}
              </MapLayout>
            );
          if (view === "parties" && aggregate)
            return (
              <PartyVotesTable title={title} results={aggregate.results} />
            );
          if (view === "recount" && aggregate)
            return (
              <PartyRecountTable
                title={title}
                votes={{
                  results: aggregate.results,
                  original: aggregate.original,
                }}
              />
            );
          if (view === "suemg" && aggregate)
            return (
              <PartySuemgTable title={title} results={aggregate.results} />
            );
        }}
      </IconTabs>
    </div>
  );
};
