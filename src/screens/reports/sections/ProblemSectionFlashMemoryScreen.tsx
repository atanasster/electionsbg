import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useElectionContext } from "@/data/ElectionContext";
import { localDate } from "@/data/utils";
import { useProblemSectionSummary } from "@/data/dashboard/useProblemSectionSummary";
import { useProblemSections } from "@/data/reports/useProblemSections";
import { PartySuemgTable } from "@/screens/components/PartySuemgTable";

export const ProblemSectionFlashMemoryScreen: FC = () => {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { selected } = useElectionContext();
  const { data: report } = useProblemSections();
  const { aggregate } = useProblemSectionSummary(id);

  const neighborhood = report?.neighborhoods.find((n) => n.id === id);
  if (!neighborhood) return null;

  const name = isBg ? neighborhood.name_bg : neighborhood.name_en;
  const title = `${name} — ${t("dashboard_flash_memory_diff")} — ${localDate(selected)}`;

  return (
    <>
      <Title description={t("all_flash_memory_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <PartySuemgTable title={title} results={aggregate?.results} />
      </div>
    </>
  );
};
