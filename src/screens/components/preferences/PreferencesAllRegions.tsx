import { PreferencesInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { PreferencesTable } from "./PreferencesTable";
import { FC } from "react";
import { useRegionVotes } from "@/data/regions/useRegionVotes";

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

const queryRegions = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  Record<string, PreferencesInfo[]> | undefined
> => {
  if (!queryKey[1]) {
    return undefined;
  }
  const response = await fetch(`/${queryKey[1]}/preferences/regions.json`);
  const data = await response.json();
  return data;
};
export const PreferencesAllRegions: FC = () => {
  const { selected, stats } = useElectionContext();
  const { countryRegions } = useRegionVotes();
  const { data: preferences } = useQuery({
    queryKey: ["preferences_all_country", selected],
    queryFn,
  });
  const { data: regions } = useQuery({
    queryKey: ["preferences_all_regions", selected],
    queryFn: queryRegions,
  });
  return preferences ? (
    <PreferencesTable
      preferences={preferences}
      region=""
      stats={stats?.find((s) => s.name === selected)}
      votes={countryRegions()}
      regionPrefs={regions}
    />
  ) : null;
};
