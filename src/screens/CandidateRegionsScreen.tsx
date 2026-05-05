import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useResolvedCandidateName } from "@/data/candidates/useResolvedCandidate";
import { CandidateByRegions } from "./components/candidates/CandidateByRegions";

export const CandidateRegionsScreen: FC = () => {
  const { id } = useParams();
  const { t } = useTranslation();
  const { name: resolved } = useResolvedCandidateName(id);
  if (!id) return null;
  // Slug URLs (mp-1234, c-15-…) only render once the resolver has fetched
  // the index. For legacy bare-name URLs we render immediately.
  const name =
    resolved ?? (id.startsWith("mp-") || id.startsWith("c-") ? null : id);
  if (!name) return null;
  return (
    <>
      <Title
        description={t("votes_by_region")}
        title={`${name} — ${t("votes_by_region")}`}
        className="text-base md:text-xl lg:text-2xl py-4 md:py-6"
      >
        <>
          {name}
          <br />
          {t("votes_by_region")}
        </>
      </Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <CandidateByRegions name={name} />
      </div>
    </>
  );
};
