import { PartyFinancing } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { matchPartyNickName } from "@/data/utils";

import { IconTabs } from "@/screens/IconTabs";
import { Caption } from "@/ux/Caption";
import { Title } from "@/ux/Title";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { Banknote, UsersRound, Vote } from "lucide-react";
import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PartyDonorsTable } from "./PartyDonorsTable";
import { PartyCandidatesTable } from "./PartyCandidatesTable";
import { PartyPartiesTable } from "./PartyPartiesTable";
import { useLastYearParties } from "@/data/parties/useLastYearParties";
import { FilingSummary } from "./campaign_financing/FilingSummary";

const dataViews = ["donors", "candidates", "parties"] as const;
type DataViewType = (typeof dataViews)[number];

const DataTypeIcons: Record<DataViewType, ReactNode> = {
  donors: <Banknote />,
  candidates: <UsersRound />,
  parties: <Vote />,
};
const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, number | null | undefined]
>): Promise<PartyFinancing | null> => {
  if (!queryKey[1] || !queryKey[2]) {
    return null;
  }
  const response = await fetch(
    `/${queryKey[1]}/parties/financing/${queryKey[2]}/filing.json`,
  );
  const data = await response.json();
  return data;
};

export const Party: FC<{ nickName: string }> = ({ nickName }) => {
  const { parties } = usePartyInfo();
  const { t } = useTranslation();
  const { selected, priorElections } = useElectionContext();
  const party = parties?.find((p) => matchPartyNickName({ nickName }, p, true));
  const { data } = useQuery({
    queryKey: ["parties_financing_per_party", selected, party?.number],
    queryFn,
  });
  const { partyByNickName } = useLastYearParties();
  const lyParty = partyByNickName(party?.nickName);
  const { data: priorFinancing } = useQuery({
    queryKey: [
      "parties_financing_per_party_prev_year",
      priorElections?.name,
      lyParty?.number,
    ],
    queryFn,
  });

  const title = party?.name || nickName;
  const shortTitle = party?.nickName || nickName;
  return (
    <div className="w-full">
      <Title>{party?.nickName || nickName}</Title>
      <Caption>{title}</Caption>
      <FilingSummary
        filing={data?.data.filing}
        priorFiling={priorFinancing?.data.filing}
        party={party}
      />
      <IconTabs<DataViewType>
        title={shortTitle}
        tabs={dataViews}
        icons={DataTypeIcons}
        storageKey="party_tabs"
        className="w-28"
      >
        {(view) => {
          if (view === "donors" && data) {
            return (
              <>
                <Caption className="py-8">{t("donors")}</Caption>
                <PartyDonorsTable data={data.data.fromDonors} />
              </>
            );
          }
          if (view == "candidates" && data) {
            return (
              <>
                <Caption className="py-8">{t("candidates")}</Caption>
                <PartyCandidatesTable data={data.data.fromCandidates} />
              </>
            );
          }
          if (view == "parties" && data) {
            return (
              <>
                <Caption className="py-8">{t("parties")}</Caption>
                <PartyPartiesTable data={data.data.fromParties} />
              </>
            );
          }
        }}
      </IconTabs>
    </div>
  );
};
