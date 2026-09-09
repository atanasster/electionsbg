import { FC, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { ElectionsBreadcrumb } from "@/screens/components/ElectionsBreadcrumb";
import { Title } from "@/ux/Title";
import {
  useAgencies,
  usePollDetails,
  usePolls,
  usePollsAccuracy,
  usePollsAnalysis,
} from "@/data/polls/usePolls";
import { AgencyProfileCard } from "./polls/AgencyProfileCard";
import { AgencyPollsList } from "./polls/AgencyPollsList";

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

export const PollsAgencyScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { agencyId } = useParams<{ agencyId: string }>();

  const { data: polls } = usePolls();
  const { data: details } = usePollDetails();
  const { data: accuracy } = usePollsAccuracy();
  const { data: analysis } = usePollsAnalysis();
  const { data: agencies } = useAgencies();

  const ready = !!polls && !!details && !!accuracy && !!analysis && !!agencies;

  const agency = useMemo(
    () => agencies?.find((a) => a.id === agencyId),
    [agencies, agencyId],
  );
  const profile = useMemo(
    () => accuracy?.agencyProfiles.find((p) => p.agencyId === agencyId),
    [accuracy, agencyId],
  );
  const take = useMemo(
    () => analysis?.agencyTakes.find((t) => t.agencyId === agencyId),
    [analysis, agencyId],
  );
  const agencyPolls = useMemo(
    () => polls?.filter((p) => p.agencyId === agencyId) ?? [],
    [polls, agencyId],
  );
  const agencyDetails = useMemo(
    () => details?.filter((d) => d.agencyId === agencyId) ?? [],
    [details, agencyId],
  );

  // Cross-agency mean MAE — used as the "consensus" reference line on the per-agency
  // MAE-history chart, so a viewer can see at a glance which cycles the agency beat or
  // missed the field on.
  const consensusMAE = useMemo(() => {
    const profiles = accuracy?.agencyProfiles ?? [];
    if (profiles.length === 0) return undefined;
    const total = profiles.reduce((s, p) => s + p.overallMAE, 0);
    return total / profiles.length;
  }, [accuracy]);

  const title = agency ? (isBg ? agency.name_bg : agency.name_en) : agencyId;

  // Shared by every branch below except the loading skeleton, so a future
  // breadcrumb/title change needs one edit rather than three.
  const header = (
    <>
      <ElectionsBreadcrumb
        hub="analysis"
        section={{ labelKey: "polls_title", to: "/polls" }}
        current={title ?? undefined}
        className="mt-4 mb-1"
      />
      <Title>{title ?? ""}</Title>
    </>
  );

  if (!ready) {
    return (
      <>
        <Title>{title ?? ""}</Title>
        <div className="w-full max-w-7xl mx-auto px-4 pb-12 flex flex-col gap-3">
          <SkeletonCard className="h-[280px]" />
          <SkeletonCard className="h-[420px]" />
        </div>
      </>
    );
  }

  if (!agency) {
    return (
      <>
        {header}
        <section className="w-full max-w-7xl mx-auto px-4 pb-12">
          <div className="mt-4 rounded-xl border bg-card p-4 shadow-sm text-sm text-muted-foreground">
            {t("polls_agency_not_found")}
          </div>
        </section>
      </>
    );
  }

  // The agency is real (it has a row in agencies.json) but `accuracy.json`'s
  // agencyProfiles only ever covers agencies with at least one SCORED poll —
  // a newly registered agency (e.g. one whose first poll is presidential and
  // therefore never enters the parliamentary accuracy corpus) has a real page
  // and zero polls, not a missing one. Conflating that with "not found" is
  // what the not-found branch used to do.
  if (!profile) {
    return (
      <>
        {header}
        <section className="w-full max-w-7xl mx-auto px-4 pb-12">
          <div className="mt-3 rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">{title}</div>
              <div className="flex items-center gap-2 shrink-0">
                {agency.eik ? (
                  <Link
                    to={`/company/${agency.eik}`}
                    className="text-[10px] font-medium text-primary hover:underline"
                    title={t("polls_public_money_hint")}
                    aria-label={t("polls_public_money_hint")}
                  >
                    {isBg ? "ТР" : "TR"}
                  </Link>
                ) : null}
                {agency.website ? (
                  <a
                    href={agency.website}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[10px] text-primary hover:underline flex items-center gap-1"
                    title={agency.website}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </div>
            {/* Only shown when the agency HAS polls that simply were not
                scored (e.g. a presidential-only publication) — with zero
                polls, AgencyPollsList's own empty state below is the single
                message, so the two do not stack as near-duplicates. */}
            {agencyPolls.length > 0 ? (
              <div className="mt-2 text-sm text-muted-foreground">
                {t("polls_agency_no_profile_yet")}
              </div>
            ) : null}
          </div>

          <div className="mt-3">
            <AgencyPollsList
              polls={agencyPolls}
              details={agencyDetails}
              elections={accuracy.elections}
            />
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      {header}
      <section className="w-full max-w-7xl mx-auto px-4 pb-12">
        <div className="mt-3">
          <AgencyProfileCard
            profile={profile}
            agency={agency}
            take={take}
            consensusMAE={consensusMAE}
            pollCount={agencyPolls.length}
          />
        </div>

        <div className="mt-3">
          <AgencyPollsList
            polls={agencyPolls}
            details={agencyDetails}
            elections={accuracy.elections}
          />
        </div>

        <div className="text-[10px] text-muted-foreground text-center mt-6">
          {t("polls_data_source")}
        </div>
      </section>
    </>
  );
};
