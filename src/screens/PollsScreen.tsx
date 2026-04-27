import { FC, ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Info, Globe2, CalendarDays } from "lucide-react";
import { Hint } from "@/ux/Hint";
import { Title } from "@/ux/Title";
import { useElectionContext } from "@/data/ElectionContext";
import { localDate } from "@/data/utils";
import {
  useAgencies,
  usePolls,
  usePollsAccuracy,
  usePollsAnalysis,
} from "@/data/polls/usePolls";
import { PollsHeadlinesTile } from "./polls/PollsHeadlinesTile";
import { PollsLeaderboardTile } from "./polls/PollsLeaderboardTile";
import { PollsLatestElectionTile } from "./polls/PollsLatestElectionTile";

const SkeletonCard: FC<{ className?: string }> = ({
  className = "h-[160px]",
}) => (
  <div
    className={`rounded-xl border bg-card p-4 shadow-sm animate-pulse ${className}`}
  >
    <div className="h-3 w-24 bg-muted rounded mb-3" />
    <div className="h-7 w-32 bg-muted rounded" />
  </div>
);

const SectionHeader: FC<{
  icon: ReactNode;
  label: ReactNode;
  hint?: string;
}> = ({ icon, label, hint }) => {
  const content = (
    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {icon}
      <span>{label}</span>
    </div>
  );
  return (
    <div className="flex items-center gap-3 mt-6 mb-2 first:mt-0">
      {hint ? (
        <Hint text={hint} underline={false}>
          {content}
        </Hint>
      ) : (
        content
      )}
      <div className="flex-1 h-px bg-border" />
    </div>
  );
};

export const PollsScreen: FC = () => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const { data: polls } = usePolls();
  const { data: accuracy } = usePollsAccuracy();
  const { data: analysis } = usePollsAnalysis();
  const { data: agencies } = useAgencies();

  const electionIso = selected?.replace(/_/g, "-");
  const selectedElection = useMemo(
    () => accuracy?.elections.find((e) => e.electionDate === electionIso),
    [accuracy, electionIso],
  );
  const selectedNarrative = useMemo(
    () => (electionIso ? analysis?.byElection?.[electionIso] : undefined),
    [analysis, electionIso],
  );

  const ready = !!polls && !!accuracy && !!analysis && !!agencies;
  const title = t("polls_title");

  if (!ready) {
    return (
      <>
        <Title description={t("polls_description")}>{title}</Title>
        <div className="w-full max-w-7xl mx-auto px-4 pb-12 flex flex-col gap-3">
          <SkeletonCard className="h-[220px]" />
          <SkeletonCard className="h-[300px]" />
          <SkeletonCard className="h-[420px]" />
        </div>
      </>
    );
  }

  const { agencyProfiles } = accuracy;

  // Top stats
  const totalPolls = polls.length;
  const realAgencies = agencies.filter((a) => a.id !== "NA").length;
  const electionsCovered = accuracy.elections.length;
  const best = agencyProfiles[0]; // sorted by overallMAE asc

  return (
    <>
      <Title description={t("polls_description")}>{title}</Title>
      <section className="w-full max-w-7xl mx-auto px-4 pb-12">
        {/* All-time section: cross-election aggregate stats */}
        <SectionHeader
          icon={<Globe2 className="h-3.5 w-3.5" />}
          label={t("polls_section_all_time")}
          hint={t("polls_section_all_time_hint")}
        />
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("polls_total_polls")}
            </div>
            <div className="text-3xl font-extrabold tabular-nums mt-1">
              {totalPolls}
            </div>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("polls_agencies")}
            </div>
            <div className="text-3xl font-extrabold tabular-nums mt-1">
              {realAgencies}
            </div>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("polls_elections_covered")}
            </div>
            <div className="text-3xl font-extrabold tabular-nums mt-1">
              {electionsCovered}
            </div>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("polls_most_accurate")}
            </div>
            <div className="text-2xl font-extrabold mt-1 truncate">
              {best?.name_en}
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              MAE {best?.overallMAE.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="mt-3">
          <PollsLeaderboardTile profiles={agencyProfiles} agencies={agencies} />
        </div>

        {/* Selected-election section: narrative + final-poll errors */}
        <SectionHeader
          icon={<CalendarDays className="h-3.5 w-3.5" />}
          label={t("polls_section_selected_election", {
            date: selected ? localDate(selected) : "",
          })}
        />
        {selectedNarrative ? (
          <PollsHeadlinesTile
            narrative={selectedNarrative}
            electionLabel={selected ? localDate(selected) : ""}
            model={analysis.model}
          />
        ) : null}

        <div className={selectedNarrative ? "mt-3" : undefined}>
          {selectedElection ? (
            <PollsLatestElectionTile
              election={selectedElection}
              agencies={agencies}
            />
          ) : (
            <div className="rounded-xl border bg-card p-4 shadow-sm flex items-start gap-3 text-sm text-muted-foreground">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                {t("polls_no_data_for_election", {
                  date: selected ? localDate(selected) : "",
                })}
              </div>
            </div>
          )}
        </div>

        <div className="text-[10px] text-muted-foreground text-center mt-6">
          {t("polls_data_source")}
        </div>
      </section>
    </>
  );
};
