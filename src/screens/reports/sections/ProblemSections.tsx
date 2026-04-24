import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MapLayout } from "@/layout/dataview/MapLayout";
import { DataViewContainer } from "@/layout/dataview/DataViewContainer";
import { SectionsMap } from "@/screens/components/sections/SectionsMap";
import { PartyVotesTable } from "@/screens/components/PartyVotesTable";
import { PartySuemgTable } from "@/screens/components/PartySuemgTable";
import { PartyRecountTable } from "@/screens/components/PartyRecountTable";
import { MultiHistoryChart } from "@/screens/components/charts/MultiHistoryChart";
import { AreaVotesTable } from "@/screens/components/AreaVotesTable";
import { ProtocolSummary } from "@/screens/components/protocols/ProtocolSummary";
import { RecountCards } from "@/screens/components/protocols/RecountCards";
import { Caption } from "@/ux/Caption";
import { H1 } from "@/ux/H1";
import { SEO } from "@/ux/SEO";
import { ErrorSection } from "@/screens/components/ErrorSection";
import { SectionInfo } from "@/data/dataTypes";
import { useProblemSections } from "@/data/reports/useProblemSections";
import { useProblemSectionsStats } from "@/data/reports/useProblemSectionsStats";
import { aggregateSections } from "@/data/reports/aggregateSections";

const NeighborhoodsLegend: FC<{
  neighborhoods: {
    id: string;
    name_bg: string;
    name_en: string;
    city_bg: string;
    city_en: string;
    source_url: string;
    sections: SectionInfo[];
  }[];
}> = ({ neighborhoods }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  return (
    <div className="w-full px-4 md:px-8 pb-4">
      <Caption className="pb-2">{t("included_neighborhoods")}</Caption>
      <div className="flex flex-wrap gap-2">
        {neighborhoods.map((n) => (
          <a
            key={n.id}
            href={n.source_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs px-2 py-1 rounded border border-red-500/40 bg-red-500/5 hover:bg-red-500/10 text-primary"
          >
            <span className="font-semibold">
              {isBg ? n.name_bg : n.name_en}
            </span>
            <span className="opacity-70">
              {" "}
              · {isBg ? n.city_bg : n.city_en} · {n.sections.length}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
};

export const ProblemSections = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useProblemSections();
  const { data: stats } = useProblemSectionsStats();

  const allSections = useMemo<SectionInfo[]>(() => {
    if (!data) return [];
    return data.neighborhoods.flatMap((n) => n.sections);
  }, [data]);

  const aggregate = useMemo(() => {
    if (!allSections.length) return undefined;
    return aggregateSections(allSections);
  }, [allSections]);

  const title = t("problem_sections");

  if (isLoading) return null;

  if (!data || !data.neighborhoods.length) {
    return (
      <div className="w-full px-4 md:px-8">
        <H1>{title}</H1>
        <ErrorSection title={t("problem_sections_not_available")} />
      </div>
    );
  }

  return (
    <div className="w-full">
      <SEO
        title={title}
        description="Polling sections in Bulgarian Roma neighborhoods widely reported as vote-buying risk areas"
        keywords={["roma", "vote buying", "problem sections", "купен вот"]}
      />
      <div className="px-4 md:px-8">
        <H1>{title}</H1>
        <p className="text-sm text-muted-foreground text-center pb-4 max-w-3xl mx-auto">
          {t("problem_sections_description")}
        </p>
      </div>
      <NeighborhoodsLegend neighborhoods={data.neighborhoods} />
      {aggregate && (
        <ProtocolSummary
          results={aggregate.results}
          original={aggregate.original}
        >
          <Caption>{title}</Caption>
        </ProtocolSummary>
      )}
      {aggregate && (
        <RecountCards
          results={aggregate.results}
          original={aggregate.original}
        />
      )}
      <DataViewContainer title={title} excluded={{ exclude: ["pref."] }}>
        {(view) => {
          if (view === "map")
            return (
              <MapLayout>
                {(size) => (
                  <SectionsMap
                    sections={allSections}
                    size={size}
                    markerVariant="problem"
                    tooltipBadge={t("problem_section_badge")}
                  />
                )}
              </MapLayout>
            );
          if (view === "table")
            return (
              <AreaVotesTable<SectionInfo>
                title={t("votes_by_section")}
                votes={allSections}
                visibleColumns={["oblast", "ekatte", "section"]}
                votesAreas={(data) => ({
                  oblast: data.oblast,
                  obshtina: data.obshtina,
                  ekatte: data.ekatte,
                  section: data.section,
                })}
              />
            );
          if (view === "parties" && aggregate)
            return (
              <PartyVotesTable
                title={title}
                results={aggregate.results}
                stats={stats || undefined}
              />
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
          if (view === "chart" && stats && stats.length)
            return <MultiHistoryChart stats={stats} />;
        }}
      </DataViewContainer>
    </div>
  );
};
