import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { useResolvedCandidate } from "@/data/candidates/useResolvedCandidate";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { CandidateProfileHeader } from "./components/candidates/CandidateProfileHeader";
import { ErrorSection } from "./components/ErrorSection";
import { CandidateDonationsTable } from "./components/candidates/CandidateDonationsTable";

export const CandidateDonationsScreen: FC = () => {
  const { id } = useParams();
  const { selected, electionStats } = useElectionContext();
  const { t } = useTranslation();
  const { canonical } = useResolvedCandidate(id);
  const { isEn, nameForBg } = useCandidateName();
  if (!id) return null;
  const lookupName =
    canonical?.name ??
    (id.startsWith("mp-") || id.startsWith("c-") ? null : id);
  if (!lookupName) return null;
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
