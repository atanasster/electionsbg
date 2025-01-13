import { PartyInfo, PartyResultsRow } from "@/data/dataTypes";
import { FC } from "react";
import { useTranslation } from "react-i18next";
import { PartyResultsTable } from "./PartyResultsTable";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "@/data/ElectionContext";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, number | null | undefined]
>): Promise<PartyResultsRow[] | null> => {
  if (!queryKey[1] || !queryKey[2]) {
    return null;
  }
  const response = await fetch(
    `/${queryKey[1]}/parties/by_region/${queryKey[2]}.json`,
  );
  const data = await response.json();
  return data;
};
export const PartyResultsByRegion: FC<{ party: PartyInfo }> = ({ party }) => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["party_votes_by_region", selected, party?.number],
    queryFn,
  });
  return (
    <PartyResultsTable
      title={t("votes_by_region")}
      visibleColumns={["oblast"]}
      data={data}
    />
  );
};
