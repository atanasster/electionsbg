import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { CandidateBySections } from "./components/candidates/CandidateBySections";

export const CandidateSectionsScreen: FC = () => {
  const { id: name } = useParams();
  const { t } = useTranslation();
  if (!name) return null;
  return (
    <>
      <Title
        description={t("votes_by_section")}
        title={`${name} — ${t("votes_by_section")}`}
        className="text-base md:text-xl lg:text-2xl py-4 md:py-6"
      >
        <>
          {name}
          <br />
          {t("votes_by_section")}
        </>
      </Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <CandidateBySections name={name} />
      </div>
    </>
  );
};
