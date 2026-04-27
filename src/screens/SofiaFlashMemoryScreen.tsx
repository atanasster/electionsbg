import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { PartySuemgTable } from "./components/PartySuemgTable";

export const SofiaFlashMemoryScreen: FC = () => {
  const { selected } = useElectionContext();
  const { t } = useTranslation();
  const { votesSofia } = useRegionVotes();
  const { results } = votesSofia() || {};
  const title = `${t("sofia_city")} — ${t("dashboard_flash_memory_diff")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("all_flash_memory_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <PartySuemgTable title={title} results={results} />
      </div>
    </>
  );
};
