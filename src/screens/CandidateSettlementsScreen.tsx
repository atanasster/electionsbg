import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { useCandidateRoute } from "@/data/candidates/useCandidateRoute";
import { CandidateRouteFallback } from "./components/candidates/CandidateRouteStates";
import { CandidateProfileHeader } from "./components/candidates/CandidateProfileHeader";
import { CandidateBySettlements } from "./components/candidates/CandidateBySettlements";

export const CandidateSettlementsScreen: FC = () => {
  const { id } = useParams();
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const route = useCandidateRoute(id);
  const { canonical, lookupName, displayName } = route;
  if (!id) return null;
  if (route.isResolving || !lookupName)
    return <CandidateRouteFallback route={route} />;
  return (
    <div className="w-full space-y-4 px-3 py-3 pb-12">
      <CandidateProfileHeader
        idParam={id}
        displayName={displayName}
        lookupName={lookupName}
        mpId={canonical?.mpId ?? route.rosterMp?.id}
        cikRows={canonical?.cikRows}
        seoTitle={`${displayName} — ${t("preferences_by_settlements")} — ${localDate(selected)}`}
      />
      <CandidateBySettlements
        name={lookupName}
        partyNum={canonical?.partyNum}
      />
    </div>
  );
};
