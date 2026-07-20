import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useResolvedCandidate } from "@/data/candidates/useResolvedCandidate";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { CandidateHeader } from "./components/candidates/CandidateHeader";
import { CandidateBySections } from "./components/candidates/CandidateBySections";

export const CandidateSectionsScreen: FC = () => {
  const { id } = useParams();
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
  return (
    <div className="w-full space-y-4 px-3 py-3 pb-12">
      <CandidateHeader
        displayName={displayName}
        lookupName={lookupName}
        cikRows={canonical?.cikRows}
        subtitle={t("votes_by_section")}
      />
      <CandidateBySections name={lookupName} partyNum={canonical?.partyNum} />
    </div>
  );
};
