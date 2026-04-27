import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useSettlementVotes } from "@/data/settlements/useSettlementVotes";
import { useSettlementStats } from "@/data/settlements/useSettlementStats";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { PartyVotesTable } from "./components/PartyVotesTable";

export const SettlementPartiesScreen: FC = () => {
  const { id: ekatte } = useParams();
  const { findSettlement } = useSettlementsInfo();
  const { settlement } = useSettlementVotes(ekatte ?? "");
  const { prevVotes, stats } = useSettlementStats(ekatte);
  const { selected } = useElectionContext();
  const { t, i18n } = useTranslation();
  if (!ekatte) return null;
  const info = findSettlement(ekatte);
  const name =
    (i18n.language === "bg"
      ? info?.long_name || info?.name
      : info?.long_name_en || info?.name_en) || ekatte;
  const title = `${name} — ${t("parties")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("all_parties_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <PartyVotesTable
          title={title}
          results={settlement?.results}
          stats={stats}
          prevElection={prevVotes}
        />
      </div>
    </>
  );
};
