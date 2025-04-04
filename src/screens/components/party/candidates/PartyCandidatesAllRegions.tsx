import { PartyInfo, PreferencesInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { FC } from "react";
import { PreferencesTable } from "../../preferences/PreferencesTable";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined, number]>): Promise<
  PreferencesInfo[] | undefined
> => {
  if (!queryKey[1]) {
    return undefined;
  }
  const response = await fetch(
    `/${queryKey[1]}/parties/preferences/${queryKey[2]}/regions.json`,
  );
  const data = await response.json();
  return data;
};

export const PartyCandidatesAllRegions: FC<{ party: PartyInfo }> = ({
  party,
}) => {
  const { selected } = useElectionContext();
  const { data: preferences } = useQuery({
    queryKey: ["party_preferences_all_country", selected, party.number],
    queryFn,
  });

  return preferences ? (
    <PreferencesTable
      preferences={preferences}
      region=""
      visibleColumns={["oblast", "candidate"]}
      hiddenColumns={["party"]}
    />
  ) : null;
};
