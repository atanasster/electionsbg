import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { useResolvedCandidate } from "@/data/candidates/useResolvedCandidate";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { CandidateProfileHeader } from "./components/candidates/CandidateProfileHeader";
import { CandidateByMunicipalities } from "./components/candidates/CandidateByMunicipalities";

export const CandidateMunicipalitiesScreen: FC = () => {
  const { id } = useParams();
  const { t } = useTranslation();
  const { selected } = useElectionContext();
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
      <CandidateProfileHeader
        idParam={id}
        displayName={displayName}
        lookupName={lookupName}
        mpId={canonical?.mpId}
        cikRows={canonical?.cikRows}
        seoTitle={`${displayName} — ${t("preferences_by_municipalities")} — ${localDate(selected)}`}
      />
      <CandidateByMunicipalities
        name={lookupName}
        partyNum={canonical?.partyNum}
      />
    </div>
  );
};
