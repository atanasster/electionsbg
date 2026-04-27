import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { CandidateByRegions } from "./components/candidates/CandidateByRegions";

export const CandidateRegionsScreen: FC = () => {
  const { id: name } = useParams();
  const { t } = useTranslation();
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
