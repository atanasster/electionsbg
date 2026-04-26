import { FC, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
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

  const title = agency ? (isBg ? agency.name_bg : agency.name_en) : agencyId;

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

  if (!profile || !agency) {
    return (
      <>
        <Title>{title ?? ""}</Title>
        <section className="w-full max-w-7xl mx-auto px-4 pb-12">
          <Link
            to="/polls"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("polls_back")}
          </Link>
          <div className="mt-4 rounded-xl border bg-card p-4 shadow-sm text-sm text-muted-foreground">
            {t("polls_agency_not_found")}
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <Title>{title ?? ""}</Title>
      <section className="w-full max-w-7xl mx-auto px-4 pb-12">
        <Link
          to="/polls"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("polls_back")}
        </Link>

        <div className="mt-3">
          <AgencyProfileCard profile={profile} agency={agency} take={take} />
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
