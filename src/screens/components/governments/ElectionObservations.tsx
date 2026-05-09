import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import {
  ElectionObservation,
  ObservationsPayload,
} from "@/data/governments/useObservations";
import { localDate } from "@/data/utils";

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

export const ElectionObservations: FC<{
  payload: ObservationsPayload | undefined;
}> = ({ payload }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  if (!payload) return null;

  const sorted = [...payload.observations].sort((a, b) =>
    a.electionDate < b.electionDate ? 1 : -1,
  );

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((o) => {
        const folderKey = o.electionDate.replace(/-/g, "_");
        return (
          <div
            key={o.electionDate}
            className="rounded-lg border bg-card p-4 shadow-sm"
          >
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold tabular-nums">
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
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                {t("gov_obs_open_report")}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              {lang === "bg" ? o.summaryBg : o.summaryEn}
            </p>
          </div>
        );
      })}
    </div>
  );
};
