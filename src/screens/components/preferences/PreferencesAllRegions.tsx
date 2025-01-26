import { PreferencesInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { PreferencesTable } from "./PreferencesTable";
import { FC } from "react";

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
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<Record<
  string,
  PreferencesInfo[]
> | null> => {
  if (!queryKey[1]) {
    return null;
  }
  const response = await fetch(`/${queryKey[1]}/preferences/regions.json`);
  const data = await response.json();
  return data;
};
export const PreferencesAllRegions: FC = () => {
  const { selected } = useElectionContext();
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
      regionPrefs={regions}
      visibleColumns={["oblast", "candidate"]}
    />
  ) : null;
};
