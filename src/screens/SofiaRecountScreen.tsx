import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { PartyRecountTable } from "./components/PartyRecountTable";

export const SofiaRecountScreen: FC = () => {
  const { selected } = useElectionContext();
  const { t } = useTranslation();
  const { votesSofia } = useRegionVotes();
  const { results, original } = votesSofia() || {};
  const title = `${t("sofia_city")} — ${t("voting_recount")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("all_recount_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <PartyRecountTable title={title} votes={{ results, original }} />
      </div>
    </>
  );
};
