import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useResolvedCandidate } from "@/data/candidates/useResolvedCandidate";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { CandidateHeader } from "./components/candidates/CandidateHeader";
import { CandidateByMunicipalities } from "./components/candidates/CandidateByMunicipalities";

export const CandidateMunicipalitiesScreen: FC = () => {
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
    <>
      <CandidateHeader
        displayName={displayName}
        lookupName={lookupName}
        cikRows={canonical?.cikRows}
        subtitle={t("votes_by_municipality")}
      />
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <CandidateByMunicipalities name={lookupName} />
      </div>
    </>
  );
};
