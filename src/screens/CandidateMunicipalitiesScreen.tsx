import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useResolvedCandidateName } from "@/data/candidates/useResolvedCandidate";
import { CandidateByMunicipalities } from "./components/candidates/CandidateByMunicipalities";

export const CandidateMunicipalitiesScreen: FC = () => {
  const { id } = useParams();
  const { t } = useTranslation();
  const { name: resolved } = useResolvedCandidateName(id);
  if (!id) return null;
  const name =
    resolved ?? (id.startsWith("mp-") || id.startsWith("c-") ? null : id);
  if (!name) return null;
  return (
    <>
      <Title
        description={t("votes_by_municipality")}
        title={`${name} — ${t("votes_by_municipality")}`}
        className="text-base md:text-xl lg:text-2xl py-4 md:py-6"
      >
        <>
          {name}
          <br />
          {t("votes_by_municipality")}
        </>
      </Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <CandidateByMunicipalities name={name} />
      </div>
    </>
  );
};
