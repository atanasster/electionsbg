import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { useCandidateRoute } from "@/data/candidates/useCandidateRoute";
import { CandidateRouteFallback } from "./components/candidates/CandidateRouteStates";
import { CandidateProfileHeader } from "./components/candidates/CandidateProfileHeader";
import { ErrorSection } from "./components/ErrorSection";
import { CandidateDonationsTable } from "./components/candidates/CandidateDonationsTable";

export const CandidateDonationsScreen: FC = () => {
  const { id } = useParams();
  const { selected, electionStats } = useElectionContext();
  const { t } = useTranslation();
  const route = useCandidateRoute(id);
  const { canonical, lookupName, displayName } = route;
  if (!id) return null;
  if (route.isResolving || !lookupName)
    return <CandidateRouteFallback route={route} />;
  if (!electionStats?.hasFinancials) {
    return (
      <ErrorSection
        title={displayName}
        description={`${t("no_financing_data")} ${localDate(selected)}`}
      />
    );
  }
  return (
    <div className="w-full space-y-4 px-3 py-3 pb-12">
      <CandidateProfileHeader
        idParam={id}
        displayName={displayName}
        lookupName={lookupName}
        mpId={canonical?.mpId ?? route.rosterMp?.id}
        cikRows={canonical?.cikRows}
        subtitle={t("donations")}
      />
      <CandidateDonationsTable name={lookupName} />
    </div>
  );
};
