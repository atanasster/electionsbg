import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useSectionsVotes } from "@/data/sections/useSectionsVotes";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { PartySuemgTable } from "./components/PartySuemgTable";

export const SectionFlashMemoryScreen: FC = () => {
  const { id: sectionCode } = useParams();
  const section = useSectionsVotes(sectionCode);
  const { selected } = useElectionContext();
  const { t } = useTranslation();
  if (!sectionCode) return null;
  const name = `${t("section")} ${sectionCode}`;
  const title = `${name} — ${t("dashboard_flash_memory_diff")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("all_flash_memory_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <PartySuemgTable title={title} results={section?.results} />
      </div>
    </>
  );
};
