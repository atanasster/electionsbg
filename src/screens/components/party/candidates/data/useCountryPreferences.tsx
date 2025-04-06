import { PartyInfo, PreferencesInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";

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

export const useCountryPreferences = (party: PartyInfo) => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["party_preferences_all_country", selected, party.number],
    queryFn,
  });
  return data;
};
