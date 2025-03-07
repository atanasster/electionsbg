import { useElectionContext } from "@/data/ElectionContext";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { localDate, matchPartyNickName } from "@/data/utils";
import { IconTabs } from "@/screens/IconTabs";
import { Caption } from "@/ux/Caption";
import { Title } from "@/ux/Title";
import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ErrorSection } from "../ErrorSection";
import { PartyFinancingScreen } from "./campaign_financing/PartyFinancingScreen";
import { Banknote, RotateCcwSquare, Vote } from "lucide-react";
import { PartyResultsScreen } from "./election_results/PartyResultsScreen";
import { PartyRecountScreen } from "./recount/PartyRecountScreen";

const dataViews = ["results", "recount", "financing"] as const;
type DataViewType = (typeof dataViews)[number];

const DataTypeIcons: Record<DataViewType, ReactNode> = {
  results: <Vote />,
  recount: <RotateCcwSquare />,
  financing: <Banknote />,
};
export const Party: FC<{ nickName: string }> = ({ nickName }) => {
  const { parties } = usePartyInfo();
  const { t } = useTranslation();
  const { selected, electionStats } = useElectionContext();
  const party = parties?.find((p) => matchPartyNickName({ nickName }, p, true));
  const excluded: { exclude: DataViewType[]; replace: DataViewType } = {
    exclude: [],
    replace: "results",
  };
  if (!electionStats?.hasFinancials) {
    excluded.exclude.push("financing");
  }
  if (!electionStats?.hasRecount) {
    excluded.exclude.push("recount");
  }
  const title = party?.name || nickName;
  return (
    <div className="w-full">
      {parties && !party ? (
        <ErrorSection
          title={nickName}
          description={`${t("no_party_information")} ${localDate(selected)}`}
        />
      ) : (
        <>
          <Title>
            {`${party?.number ? `${party.number} - ` : ""}${party?.nickName || nickName}`}
          </Title>
          <Caption>{title}</Caption>
          <IconTabs<DataViewType>
            title={nickName}
            tabs={dataViews}
            icons={DataTypeIcons}
            storageKey="party_tabs"
            excluded={excluded}
            className="w-28"
          >
            {(view) => {
              if (view === "results")
                return party && <PartyResultsScreen party={party} />;
              if (view === "recount")
                return party && <PartyRecountScreen party={party} />;
              if (view === "financing")
                return <PartyFinancingScreen party={party} />;
            }}
          </IconTabs>
        </>
      )}
    </div>
  );
};
