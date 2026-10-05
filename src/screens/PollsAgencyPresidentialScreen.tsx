// `/polls/:agencyId/presidential` — one agency's presidential polls, the presidential side of the
// agency page's race toggle. Same header as the parliamentary agency page, then the agency's
// round-one grade per presidential cycle (the parliamentary rule, see
// `parliamentaryRuleAgencies`), then its full presidential campaign explorer.

import { FC, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Target } from "lucide-react";
import { useAgencies } from "@/data/polls/useAgencies";
import { usePresidentialPollsAccuracy } from "@/data/presidential/usePresidentialPolls";
import { presidentialAgencyCycles } from "@/data/presidential/presidentialPollAccuracy";
import { presidentialUrl } from "@/data/elections/presidentialRoutes";
import { ElectionsBreadcrumb } from "@/screens/components/ElectionsBreadcrumb";
import { StatCard } from "@/screens/dashboard/StatCard";
import {
  agencyMaeBarStyle,
  missColorClass,
  missSign,
} from "@/screens/dashboard/agencyMaeBar";
import { PresidentialPersonName } from "@/screens/presidential/PresidentialPersonName";
import { Hint } from "@/ux/Hint";
import { Link } from "@/ux/Link";
import { Title } from "@/ux/Title";
import { PollsRaceToggle } from "./polls/PollsRaceToggle";
import { PresidentialHistory } from "./polls/PresidentialHistory";

const AgencyPresidentialAccuracy: FC<{ agencyId: string }> = ({ agencyId }) => {
  const { t } = useTranslation();
  const aq = usePresidentialPollsAccuracy();
  const rows = useMemo(
    () => presidentialAgencyCycles(aq.data?.cycles ?? [], agencyId),
    [aq.data, agencyId],
  );
  // The explorer below owns loading and error states for this query.
  if (!rows.length) return null;
  const maxMae = Math.max(0.01, ...rows.map((r) => r.grade.mae));
  return (
    <StatCard
      label={
        <Hint text={t("presidential_polls_tile_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            <span>{t("polls_title")}</span>
          </div>
        </Hint>
      }
    >
      <div className="grid grid-cols-[auto_minmax(120px,4fr)_auto_auto_minmax(0,1.6fr)] gap-x-3 gap-y-1.5 items-center mt-2 text-sm">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("presidential_polls_trend_cycle")}
        </span>
        <span />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
          MAE
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
          {t("polls_days_before")}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("polls_biggest_miss")}
        </span>
        {rows.map(({ cycle, grade }) => {
          const { widthPct, hue } = agencyMaeBarStyle(grade.mae, maxMae);
          const miss = grade.errors.find(
            (e) => e.key === grade.biggestMiss.key,
          );
          const url = presidentialUrl(cycle.cycle, "country");
          return (
            <div className="contents" key={cycle.cycle}>
              {url ? (
                <Link
                  to={url}
                  className="tabular-nums hover:underline"
                  underline={false}
                >
                  {cycle.round1Date.slice(0, 4)}
                </Link>
              ) : (
                <span className="tabular-nums">
                  {cycle.round1Date.slice(0, 4)}
                </span>
              )}
              <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="absolute top-0 bottom-0 left-0 rounded-full"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: `hsl(${hue} 70% 45%)`,
                  }}
                />
              </div>
              <span className="tabular-nums text-xs font-semibold text-right">
                {grade.mae.toFixed(2)}
              </span>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {grade.daysBefore}d
              </span>
              <span className="text-xs flex items-center gap-1.5 min-w-0">
                <span className="truncate min-w-0">
                  {grade.biggestMiss.key !== "други" &&
                  grade.biggestMiss.key !== "none" &&
                  miss ? (
                    <PresidentialPersonName name={miss.name_bg} />
                  ) : (
                    <span className="font-medium">
                      {miss?.name_bg ?? grade.biggestMiss.key}
                    </span>
                  )}
                </span>
                <span
                  className={`tabular-nums font-semibold shrink-0 ${missColorClass(grade.biggestMiss.error)}`}
                >
                  {missSign(grade.biggestMiss.error)}
                  {grade.biggestMiss.error.toFixed(1)}pp
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </StatCard>
  );
};

export function PollsAgencyPresidentialScreen() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { t, i18n } = useTranslation();
  const agencies = useAgencies();
  const agency = agencies.data?.find((a) => a.id === agencyId);
  const name = agency
    ? i18n.language === "bg"
      ? agency.name_bg
      : agency.name_en
    : agencyId;
  return (
    <>
      <ElectionsBreadcrumb
        hub="analysis"
        section={{ labelKey: "polls_title", to: "/polls" }}
        current={name ?? undefined}
        className="mt-4 mb-1"
      />
      <Title
        title={`${name} · ${t("polls_presidential_polls")}`}
        description={t("pp_history_chart_hint")}
      >
        {name ?? ""}
      </Title>
      <section className="w-full max-w-7xl mx-auto px-4 pb-12 space-y-3">
        <PollsRaceToggle race="presidential" agencyId={agencyId} />
        {agencyId ? <AgencyPresidentialAccuracy agencyId={agencyId} /> : null}
        <PresidentialHistory agencyId={agencyId} />
      </section>
    </>
  );
}
