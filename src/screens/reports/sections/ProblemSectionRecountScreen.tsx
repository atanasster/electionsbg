import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useElectionContext } from "@/data/ElectionContext";
import { localDate } from "@/data/utils";
import { useProblemSectionSummary } from "@/data/dashboard/useProblemSectionSummary";
import { useProblemSections } from "@/data/reports/useProblemSections";
import { PartyRecountTable } from "@/screens/components/PartyRecountTable";

export const ProblemSectionRecountScreen: FC = () => {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { selected } = useElectionContext();
  const { data: report } = useProblemSections();
  const { aggregate } = useProblemSectionSummary(id);

  const neighborhood = report?.neighborhoods.find((n) => n.id === id);
  if (!neighborhood) return null;

  const name = isBg ? neighborhood.name_bg : neighborhood.name_en;
  const title = `${name} — ${t("voting_recount")} — ${localDate(selected)}`;

  return (
    <>
      <Title description={t("all_recount_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <PartyRecountTable
          title={title}
          votes={
            aggregate
              ? { results: aggregate.results, original: aggregate.original }
              : undefined
          }
        />
      </div>
    </>
  );
};
