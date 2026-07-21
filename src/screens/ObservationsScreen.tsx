import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { ArticleLayout } from "@/components/article/ArticleLayout";
import { useObservations } from "@/data/governments/useObservations";
import { localDate } from "@/data/utils";
import type { ElectionObservation } from "@/data/governments/useObservations";

const missionLabel = (
  type: ElectionObservation["missionType"],
  lang: string,
): string => {
  if (type === "EAM")
    return lang === "bg" ? "Мисия за оценка" : "Election Assessment Mission";
  if (type === "LEOM")
    return lang === "bg"
      ? "Ограничена мисия за наблюдение"
      : "Limited Election Observation Mission";
  return lang === "bg" ? "Мисия за наблюдение" : "Election Observation Mission";
};

export const ObservationsScreen = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data: payload, isLoading } = useObservations();

  const sorted = payload
    ? [...payload.observations].sort((a, b) =>
        a.electionDate < b.electionDate ? 1 : -1,
      )
    : [];

  return (
    <ArticleLayout
      title={t("observations_title")}
      description={t("observations_description")}
      breadcrumb={null}
      seoType="website"
    >
      <p className="text-sm text-muted-foreground mb-6 max-w-3xl leading-relaxed">
        {t("observations_explainer")}
      </p>

      {isLoading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border bg-card p-5 shadow-sm animate-pulse"
            >
              <div className="h-4 w-40 bg-muted rounded mb-3" />
              <div className="h-3 w-full bg-muted rounded mb-2" />
              <div className="h-3 w-4/5 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4" data-og="observations-list">
          {sorted.map((o) => {
            const folderKey = o.electionDate.replace(/-/g, "_");
            const summary =
              lang === "bg"
                ? (o.longSummaryBg ?? o.summaryBg)
                : (o.longSummaryEn ?? o.summaryEn);
            return (
              <div
                key={o.electionDate}
                className="rounded-lg border bg-card p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-semibold tabular-nums text-base">
                      {localDate(folderKey)}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide bg-accent/10 text-foreground px-2 py-0.5 rounded">
                      {o.missionType}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {missionLabel(o.missionType, lang)}
                    </span>
                  </div>
                  <a
                    href={o.reportUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1 shrink-0"
                  >
                    {t("gov_obs_open_report")}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {summary}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {payload ? (
        <p className="text-[11px] text-muted-foreground mt-8">
          {t("governments_source_prefix")}{" "}
          <a
            href={payload.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {payload.source}
          </a>
        </p>
      ) : null}
    </ArticleLayout>
  );
};
