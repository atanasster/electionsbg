import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { H1 } from "@/ux/H1";
import { SEO } from "@/ux/SEO";
import { ErrorSection } from "@/screens/components/ErrorSection";
import { useProblemSections } from "@/data/reports/useProblemSections";
import { ProblemSectionDashboardCards } from "@/screens/dashboard/ProblemSectionDashboardCards";

export const ProblemSectionDetail: FC = () => {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data, isLoading } = useProblemSections();

  const neighborhood = data?.neighborhoods.find((n) => n.id === id);

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
        <div className="flex items-center justify-center gap-3 pb-2 text-sm text-muted-foreground">
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
        <ProblemSectionDashboardCards neighborhood={neighborhood} />
      </div>
    </div>
  );
};
