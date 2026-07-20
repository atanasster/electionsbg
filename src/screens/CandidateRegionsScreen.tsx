import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useResolvedCandidate } from "@/data/candidates/useResolvedCandidate";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { CandidateHeader } from "./components/candidates/CandidateHeader";
import { CandidateByRegions } from "./components/candidates/CandidateByRegions";

export const CandidateRegionsScreen: FC = () => {
  const { id } = useParams();
  const { t } = useTranslation();
  const { canonical } = useResolvedCandidate(id);
  const { isEn, nameForBg } = useCandidateName();
  if (!id) return null;
  // Slug URLs (mp-1234, c-15-…) only render once the resolver has fetched
  // the index. For legacy bare-name URLs we render immediately.
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
        subtitle={t("votes_by_region")}
      />
      <CandidateByRegions name={lookupName} partyNum={canonical?.partyNum} />
    </div>
  );
};
