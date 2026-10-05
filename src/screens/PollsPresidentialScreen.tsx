// `/polls/presidential` — the presidential side of the polls hub, reached by the race toggle on
// `/polls`. Same order as the parliamentary page: headline stats, an agency leaderboard, the
// accuracy trend, then the per-agency latest polls and the full campaign explorer.
//
// ⚠ THE LEADERBOARD IS AN UNWEIGHTED MEAN OF ROUND-ONE GRADES ACROSS CYCLES, with the number of
// graded cycles beside each agency. The presidential corpus is small (three graded cycles), so
// it carries no A–F grade and no shrinkage — the parliamentary `AgencyProfile` machinery needs a
// history this corpus does not have, and borrowing its grade letters would claim one.

import { FC, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Activity, Globe2, Trophy } from "lucide-react";
import { Title } from "@/ux/Title";
import { Hint } from "@/ux/Hint";
import { Link } from "@/ux/Link";
import { localDate } from "@/data/utils";
import { useAgencies } from "@/data/polls/useAgencies";
import {
  usePresidentialPollsAccuracy,
  usePresidentialPollsList,
} from "@/data/presidential/usePresidentialPolls";
import {
  presidentialAgencyStandings,
  presidentialTrendRows,
} from "@/data/presidential/presidentialPollAccuracy";
import { presidentialUrl } from "@/data/elections/presidentialRoutes";
import { ElectionsBreadcrumb } from "@/screens/components/ElectionsBreadcrumb";
import { StatCard } from "@/screens/dashboard/StatCard";
import { agencyMaeBarStyle } from "@/screens/dashboard/agencyMaeBar";
import { AccuracyTrendsBars } from "./polls/AccuracyTrendsBars";
import { PollsRaceToggle } from "./polls/PollsRaceToggle";
import { PollsSectionHeader } from "./polls/PollsSectionHeader";
import { PresidentialHistory } from "./polls/PresidentialHistory";
import { PresidentialPollsSection } from "./polls/PresidentialPollsSection";

const Stat: FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="rounded-xl border bg-card p-4 shadow-sm min-w-0">
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    {children}
  </div>
);

export const PollsPresidentialScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const navigate = useNavigate();
  const aq = usePresidentialPollsAccuracy();
  const pq = usePresidentialPollsList();
  const { data: agencyList } = useAgencies();

  const cycles = useMemo(() => aq.data?.cycles ?? [], [aq.data]);
  const standings = useMemo(
    () => presidentialAgencyStandings(cycles),
    [cycles],
  );
  const trend = useMemo(() => presidentialTrendRows(cycles), [cycles]);
  const polls = pq.data ?? [];

  const nameOf = (id: string) => {
    const ag = agencyList?.find((x) => x.id === id);
    return ag ? (isBg ? ag.name_bg : ag.name_en) : id;
  };
  const goToCycle = useCallback(
    (date: string) => {
      const row = trend.find((r) => r.date === date);
      const url = row ? presidentialUrl(row.cycle, "country") : null;
      if (url) navigate(url);
    },
    [trend, navigate],
  );

  const best = standings[0];
  const maxMae = Math.max(0.01, ...standings.map((s) => s.meanMae));
  const title = t("polls_presidential_title");

  return (
    <>
      <ElectionsBreadcrumb
        hub="analysis"
        section={{ labelKey: "polls_title", to: "/polls" }}
        current={t("polls_race_presidential")}
        className="mt-4 mb-1"
      />
      <Title description={t("polls_presidential_description")}>{title}</Title>
      <section className="pb-12">
        <PollsRaceToggle race="presidential" />

        <PollsSectionHeader
          icon={<Globe2 className="h-3.5 w-3.5" />}
          label={t("polls_section_all_time")}
          hint={t("polls_presidential_all_time_hint")}
        />
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Stat label={t("polls_total_polls")}>
            <div className="text-3xl font-extrabold tabular-nums mt-1">
              {pq.data ? polls.length : "—"}
            </div>
          </Stat>
          <Stat label={t("polls_agencies")}>
            <div className="text-3xl font-extrabold tabular-nums mt-1">
              {pq.data ? new Set(polls.map((p) => p.agencyId)).size : "—"}
            </div>
          </Stat>
          <Stat label={t("polls_elections_covered")}>
            <div className="text-3xl font-extrabold tabular-nums mt-1">
              {pq.data
                ? new Set(polls.map((p) => p.cycle).filter(Boolean)).size
                : "—"}
            </div>
          </Stat>
          <Stat label={t("polls_most_accurate")}>
            {best ? (
              <>
                <div className="text-2xl font-extrabold truncate mt-1">
                  {nameOf(best.agencyId)}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  MAE {best.meanMae.toFixed(2)}
                </div>
              </>
            ) : (
              <div className="text-3xl font-extrabold mt-1">—</div>
            )}
          </Stat>
        </div>

        {standings.length ? (
          <div className="mt-3">
            <StatCard
              label={
                <Hint
                  text={t("polls_presidential_leaderboard_hint")}
                  underline={false}
                >
                  <div className="flex items-center gap-2">
                    <Trophy className="h-4 w-4" />
                    <span>{t("polls_leaderboard")}</span>
                  </div>
                </Hint>
              }
            >
              <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(120px,3fr)_auto_auto_auto] gap-x-3 gap-y-1.5 items-center mt-2 text-sm">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  #
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("polls_agency")}
                </span>
                <span />
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
                  MAE
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
                  {t("polls_presidential_cycles_graded")}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
                  {t("polls_days_before")}
                </span>
                {standings.map((s, i) => {
                  const { widthPct, hue } = agencyMaeBarStyle(
                    s.meanMae,
                    maxMae,
                  );
                  return (
                    <div className="contents" key={s.agencyId}>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {i + 1}
                      </span>
                      <Link
                        to={`/polls/${s.agencyId}/presidential`}
                        className="font-medium truncate hover:underline"
                        underline={false}
                      >
                        {nameOf(s.agencyId)}
                      </Link>
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
                        {s.meanMae.toFixed(2)}
                      </span>
                      <span className="tabular-nums text-xs text-muted-foreground text-right">
                        {s.cycles}
                      </span>
                      <span className="tabular-nums text-xs text-muted-foreground text-right">
                        {Math.round(s.medianDaysBefore)}d
                      </span>
                    </div>
                  );
                })}
              </div>
            </StatCard>
          </div>
        ) : null}

        {trend.length >= 2 ? (
          <>
            <PollsSectionHeader
              icon={<Activity className="h-3.5 w-3.5" />}
              label={t("dashboard_accuracy_trends")}
              hint={t("presidential_polls_trend_hint")}
            />
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <AccuracyTrendsBars
                height={300}
                onSelect={goToCycle}
                rows={trend.map((r) => ({
                  date: r.date,
                  label: localDate(r.date.replace(/-/g, "_")),
                  avgMae: r.avgMae,
                  maxMae: r.maxMae,
                  agencyCount: r.agencyCount,
                  isSelected: false,
                }))}
              />
            </div>
          </>
        ) : null}

        {agencyList ? <PresidentialPollsSection agencies={agencyList} /> : null}

        <div className="mt-6">
          <PresidentialHistory />
        </div>

        <div className="text-[10px] text-muted-foreground text-center mt-6">
          {t("polls_data_source")}
        </div>
      </section>
    </>
  );
};
