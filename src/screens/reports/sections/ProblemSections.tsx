import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Caption } from "@/ux/Caption";
import { H1 } from "@/ux/H1";
import { SEO } from "@/ux/SEO";
import { Link } from "@/ux/Link";
import { ErrorSection } from "@/screens/components/ErrorSection";
import { SectionInfo } from "@/data/dataTypes";
import { useProblemSections } from "@/data/reports/useProblemSections";
import { ProblemSectionDashboardCards } from "@/screens/dashboard/ProblemSectionDashboardCards";

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
    <div className="w-full pb-4">
      <Caption className="pb-2">{t("included_neighborhoods")}</Caption>
      <div className="flex flex-wrap gap-2">
        {neighborhoods.map((n) => (
          <Link
            key={n.id}
            to={`/reports/section/problem_sections/${n.id}`}
            underline={false}
            className="text-xs px-2 py-1 rounded border border-destructive/40 bg-destructive/5 hover:bg-destructive/10 text-foreground"
          >
            <span className="font-semibold">
              {isBg ? n.name_bg : n.name_en}
            </span>
            <span className="opacity-70">
              {" "}
              · {isBg ? n.city_bg : n.city_en} · {n.sections.length}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
};

export const ProblemSections = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useProblemSections();

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
        <NeighborhoodsLegend neighborhoods={data.neighborhoods} />
        <ProblemSectionDashboardCards />
      </div>
    </div>
  );
};
