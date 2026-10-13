import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { useResolvedCandidateWithFallback } from "@/data/candidates/useCandidateElectionFallback";
import {
  CandidateNotFound,
  CandidateResolving,
} from "./components/candidates/CandidateRouteStates";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { CandidateProfileHeader } from "./components/candidates/CandidateProfileHeader";
import { ErrorSection } from "./components/ErrorSection";
import { CandidateDonationsTable } from "./components/candidates/CandidateDonationsTable";

export const CandidateDonationsScreen: FC = () => {
  const { id } = useParams();
  const { selected, electionStats } = useElectionContext();
  const { t } = useTranslation();
  const { canonical, isResolving, notFound } =
    useResolvedCandidateWithFallback(id);
  const { isEn, nameForBg } = useCandidateName();
  if (!id) return null;
  // Probing other elections for a slug minted elsewhere (and switching to it).
  if (isResolving) return <CandidateResolving minHeight="min-h-[800px]" />;
  if (notFound) return <CandidateNotFound />;
  const lookupName =
    canonical?.name ??
    (id.startsWith("mp-") || id.startsWith("c-") ? null : id);
  if (!lookupName) return <CandidateNotFound />;
  const displayName = canonical
    ? isEn
      ? canonical.name_en
      : canonical.name
    : nameForBg(lookupName);
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
        mpId={canonical?.mpId}
        cikRows={canonical?.cikRows}
        subtitle={t("donations")}
      />
      <CandidateDonationsTable name={lookupName} />
    </div>
  );
};
