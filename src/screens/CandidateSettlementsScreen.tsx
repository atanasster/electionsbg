import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { CandidateBySettlements } from "./components/candidates/CandidateBySettlements";

export const CandidateSettlementsScreen: FC = () => {
  const { id: name } = useParams();
  const { t } = useTranslation();
  if (!name) return null;
  return (
    <>
      <Title
        description={t("votes_by_settlement")}
        title={`${name} — ${t("votes_by_settlement")}`}
        className="text-base md:text-xl lg:text-2xl py-4 md:py-6"
      >
        <>
          {name}
          <br />
          {t("votes_by_settlement")}
        </>
      </Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <CandidateBySettlements name={name} />
      </div>
    </>
  );
};
