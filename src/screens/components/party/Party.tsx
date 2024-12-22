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
>): Promise<PartyFinancing | undefined> => {
  if (!queryKey[1] || !queryKey[2]) {
    return undefined;
  }
  const response = await fetch(
    `/${queryKey[1]}/parties/financing/${queryKey[2]}/income.json`,
  );
  const data = await response.json();
  return data;
};

export const Party: FC<{ nickName: string }> = ({ nickName }) => {
  const { parties } = usePartyInfo();
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const party = parties?.find((p) => matchPartyNickName({ nickName }, p, true));
  const { data } = useQuery({
    queryKey: ["parties_financing_per_party", selected, party?.number],
    queryFn,
  });
  const title = party?.name || nickName;
  const shortTitle = party?.nickName || nickName;
  return (
    <div className="w-full">
      <Title>{party?.nickName || nickName}</Title>
      <IconTabs
        title={title}
        shortTitle={shortTitle}
        tabs={dataViews}
        icons={DataTypeIcons}
        storageKey="party_tabs"
      >
        {(view) => {
          if (view === "donors" && data) {
            return (
              <>
                <Caption className="py-8">
                  {t("donors")} {title}
                </Caption>
              </>
            );
          }
          if (view == "candidates" && data) {
            return (
              <>
                <Caption className="py-8">
                  {t("candidates")} {title}
                </Caption>
              </>
            );
          }
          if (view == "parties" && data) {
            return (
              <>
                <Caption className="py-8">
                  {t("parties")} {title}
                </Caption>
              </>
            );
          }
        }}
      </IconTabs>
    </div>
  );
};
