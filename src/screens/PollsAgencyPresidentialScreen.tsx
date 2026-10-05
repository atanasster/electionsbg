// `/polls/:agencyId/presidential` — one agency's presidential polls, the presidential side of the
// agency page's race toggle. Laid out like the parliamentary agency page: a profile card (the
// round-one grades `presidentialAgencyProfile` derives), then every poll with its published shares
// against the official result. The cross-agency campaign explorer lives on `/polls/presidential`.

import { FC, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAgencies } from "@/data/polls/useAgencies";
import {
  usePresidentialPollDetails,
  usePresidentialPollsAccuracy,
  usePresidentialPollsList,
  usePresidentialRunoffs,
} from "@/data/presidential/usePresidentialPolls";
import { presidentialAgencyProfile } from "@/data/presidential/presidentialPollAccuracy";
import { ElectionsBreadcrumb } from "@/screens/components/ElectionsBreadcrumb";
import { StatCard } from "@/screens/dashboard/StatCard";
import { Title } from "@/ux/Title";
import { PollsRaceToggle } from "./polls/PollsRaceToggle";
import {
  PresidentialAgencyHeader,
  PresidentialAgencyProfileCard,
} from "./polls/PresidentialAgencyProfileCard";
import { PresidentialAgencyPollsList } from "./polls/PresidentialAgencyPollsList";

const SkeletonCard: FC<{ className: string }> = ({ className }) => (
  <div
    className={`rounded-xl border bg-card p-4 shadow-sm animate-pulse ${className}`}
  >
    <div className="h-3 w-24 bg-muted rounded mb-3" />
    <div className="h-7 w-32 bg-muted rounded" />
  </div>
);

export const PollsAgencyPresidentialScreen: FC = () => {
  const { agencyId = "" } = useParams<{ agencyId: string }>();
  const { t, i18n } = useTranslation();
  const agencies = useAgencies();
  const pq = usePresidentialPollsList();
  const dq = usePresidentialPollDetails();
  const rq = usePresidentialRunoffs();
  const aq = usePresidentialPollsAccuracy();
  const queries = [pq, dq, rq, aq];

  const agency = agencies.data?.find((a) => a.id === agencyId);
  const name = agency
    ? i18n.language === "bg"
      ? agency.name_bg
      : agency.name_en
    : agencyId;
  const polls = useMemo(
    () => (pq.data ?? []).filter((p) => p.agencyId === agencyId),
    [pq.data, agencyId],
  );
  const details = useMemo(
    () => (dq.data ?? []).filter((d) => d.agencyId === agencyId),
    [dq.data, agencyId],
  );
  const cycles = useMemo(() => aq.data?.cycles ?? [], [aq.data]);
  const profile = useMemo(
    () => presidentialAgencyProfile(cycles, agencyId),
    [cycles, agencyId],
  );

  return (
    <>
      <ElectionsBreadcrumb
        hub="analysis"
        section={{ labelKey: "polls_title", to: "/polls" }}
        current={name}
        className="mt-4 mb-1"
      />
      <Title
        title={`${name} · ${t("polls_presidential_polls")}`}
        description={t("pp_history_chart_hint")}
      >
        {name}
      </Title>
      <section className="w-full max-w-7xl mx-auto px-4 pb-12 flex flex-col gap-3">
        <PollsRaceToggle race="presidential" agencyId={agencyId} />
        {queries.some((q) => q.isError) ? (
          <div role="alert" className="text-sm">
            {t("pp_history_load_error")}{" "}
            <button
              type="button"
              className="underline text-primary"
              onClick={() => queries.forEach((q) => void q.refetch())}
            >
              {t("pp_history_retry")}
            </button>
          </div>
        ) : queries.some((q) => q.isPending) ? (
          <>
            <SkeletonCard className="h-[280px]" />
            <SkeletonCard className="h-[420px]" />
          </>
        ) : (
          <>
            {profile ? (
              <PresidentialAgencyProfileCard
                profile={profile}
                agency={agency}
                pollCount={polls.length}
              />
            ) : (
              <StatCard
                label={
                  <PresidentialAgencyHeader
                    agency={agency}
                    agencyId={agencyId}
                  />
                }
              >
                <div className="text-sm text-muted-foreground">
                  {t("presidential_agency_not_graded")}
                </div>
              </StatCard>
            )}
            <PresidentialAgencyPollsList
              polls={polls}
              details={details}
              runoffs={rq.data ?? []}
              cycles={cycles}
            />
          </>
        )}
        <div className="text-[10px] text-muted-foreground text-center mt-3">
          {t("polls_data_source")}
        </div>
      </section>
    </>
  );
};
