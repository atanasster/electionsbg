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
import { CandidateByMunicipalities } from "./components/candidates/CandidateByMunicipalities";

export const CandidateMunicipalitiesScreen: FC = () => {
  const { id } = useParams();
  const { t } = useTranslation();
  const { selected } = useElectionContext();
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
