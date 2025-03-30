import { PartyInfo, PreferencesInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { FC, useMemo } from "react";
import { PreferencesTable } from "../../preferences/PreferencesTable";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  PreferencesInfo[] | undefined
> => {
  if (!queryKey[1]) {
    return undefined;
  }
  const response = await fetch(`/${queryKey[1]}/preferences/country.json`);
  const data = await response.json();
  return data;
};

export const PartyCandidatesAllRegions: FC<{ party: PartyInfo }> = ({
  party,
}) => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["party_preferences_all_country", selected],
    queryFn,
  });

  const preferences = useMemo(() => {
    return data?.filter((d) => d.partyNum === party.number);
  }, [data, party.number]);
  const regions = useMemo(
    () =>
      preferences?.reduce((acc: Record<string, PreferencesInfo[]>, curr) => {
        if (curr.oblast) {
          if (acc[curr.oblast] === undefined) {
            acc[curr.oblast] = [];
          }
          acc[curr.oblast].push(curr);
        }
        return acc;
      }, {}),
    [preferences],
  );
  return preferences ? (
    <PreferencesTable
      preferences={preferences}
      region=""
      regionPrefs={regions}
      visibleColumns={["oblast", "candidate"]}
      hiddenColumns={["party"]}
    />
  ) : null;
};
