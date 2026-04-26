import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useElectionContext } from "@/data/ElectionContext";
import { useRegionVotes } from "@/data/regions/useRegionVotes";
import { localDate } from "@/data/utils";
import { PartyRecountTable } from "./components/PartyRecountTable";

export const AllRecountScreen: FC = () => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const { countryVotes } = useRegionVotes();
  const votes = countryVotes();
  const title = `${t("voting_recount")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("all_recount_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <PartyRecountTable title={title} votes={votes} />
      </div>
    </>
  );
};
