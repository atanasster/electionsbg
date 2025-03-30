import { PartyInfo, PreferencesInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { PreferencesTable } from "../../preferences/PreferencesTable";
import { FC, useMemo } from "react";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | undefined]
>): Promise<PreferencesInfo[] | null> => {
  if (!queryKey[1] || !queryKey[2]) {
    return null;
  }
  const response = await fetch(
    `/${queryKey[1]}/preferences/by_municipality/${queryKey[2]}.json`,
  );
  const data = await response.json();
  return data;
};
export const PartyCandidatesByMunicipality: FC<{
  municipality?: string;
  region?: string;
  party: PartyInfo;
}> = ({ municipality, region, party }) => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["preferences_by_municipality", selected, municipality],
    queryFn,
  });
  const preferences = useMemo(() => {
    return data?.filter((d) => d.partyNum === party.number);
  }, [data, party.number]);
  return preferences && region ? (
    <PreferencesTable
      preferences={preferences}
      region={region}
      visibleColumns={["candidate"]}
    />
  ) : null;
};
