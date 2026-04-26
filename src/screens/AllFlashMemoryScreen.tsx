import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useElectionContext } from "@/data/ElectionContext";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { localDate } from "@/data/utils";
import { PartySuemgTable } from "./components/PartySuemgTable";

export const AllFlashMemoryScreen: FC = () => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const { countryVotes } = useRegionVotes();
  const { results } = countryVotes();
  const title = `${t("dashboard_flash_memory_diff")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("all_flash_memory_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <PartySuemgTable title={title} results={results} />
      </div>
    </>
  );
};
