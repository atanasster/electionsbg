// Surfaces the most recent OSCE/ODIHR election-mission summary on the
// governance dashboard. Picks the latest entry from election-observations.json
// and shows a single-paragraph excerpt plus a link to the full /observations
// list. Renders nothing when the payload is missing.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, ExternalLink, ScrollText } from "lucide-react";
import { Link } from "react-router-dom";
import { useObservations } from "@/data/governments/useObservations";
import { localDate } from "@/data/utils";
import { StatCard } from "@/screens/dashboard/StatCard";

const missionLabel = (type: string, lang: string): string => {
  if (type === "EAM")
    return lang === "bg" ? "Мисия за оценка" : "Election Assessment Mission";
  if (type === "LEOM")
    return lang === "bg"
      ? "Ограничена мисия за наблюдение"
      : "Limited Election Observation Mission";
  return lang === "bg" ? "Мисия за наблюдение" : "Election Observation Mission";
};

const MAX_SUMMARY_CHARS = 360;

const truncate = (text: string, limit: number): string => {
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const lastSpace = slice.lastIndexOf(" ");
  return `${slice.slice(0, lastSpace > 0 ? lastSpace : limit).trim()}…`;
};

export const GovernanceObservationsTile: FC<{ className?: string }> = ({
  className,
}) => {
  const { t, i18n } = useTranslation();
  const { data: payload } = useObservations();
  const lang = i18n.language === "bg" ? "bg" : "en";

  const latest = useMemo(() => {
    if (!payload?.observations?.length) return null;
    return [...payload.observations].sort((a, b) =>
      a.electionDate < b.electionDate ? 1 : -1,
    )[0];
  }, [payload]);

  if (!latest) return null;

  const summary = lang === "bg" ? latest.summaryBg : latest.summaryEn;
  const folderKey = latest.electionDate.replace(/-/g, "_");

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ScrollText className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("governance_observations_title") ||
                "Latest OSCE/ODIHR finding"}
            </span>
          </div>
          <Link
            to="/observations"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case shrink-0"
          >
            {t("dashboard_see_details") || "See details"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-sm font-semibold tabular-nums">
          {localDate(folderKey)}
        </span>
        <span className="text-[10px] uppercase tracking-wide bg-accent/10 text-foreground px-2 py-0.5 rounded">
          {latest.missionType}
        </span>
        <span className="text-xs text-muted-foreground">
          {missionLabel(latest.missionType, lang)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {truncate(summary, MAX_SUMMARY_CHARS)}
      </p>
      <a
        href={latest.reportUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 self-start"
      >
        {t("gov_obs_open_report") || "Open report"}
        <ExternalLink className="h-3 w-3" />
      </a>
    </StatCard>
  );
};
