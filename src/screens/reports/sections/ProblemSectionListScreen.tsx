import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useElectionContext } from "@/data/ElectionContext";
import { localDate } from "@/data/utils";
import { useProblemSections } from "@/data/reports/useProblemSections";
import { SectionsList } from "@/screens/components/sections/SectionsList";

export const ProblemSectionListScreen: FC = () => {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { selected } = useElectionContext();
  const { data: report } = useProblemSections();

  const neighborhood = report?.neighborhoods.find((n) => n.id === id);
  if (!neighborhood) return null;

  const name = isBg ? neighborhood.name_bg : neighborhood.name_en;
  const title = `${name} — ${t("sections")} — ${localDate(selected)}`;

  return (
    <>
      <Title description={t("all_sections_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <SectionsList sections={neighborhood.sections} title={name} />
      </div>
    </>
  );
};
