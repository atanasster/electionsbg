import { PreferencesInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { PreferencesTable } from "./PreferencesTable";
import { FC } from "react";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | undefined]
>): Promise<PreferencesInfo[] | null> => {
  if (!queryKey[1] || !queryKey[2]) {
    return null;
  }
  const response = await fetch(
    `/${queryKey[1]}/preferences/by_region/${queryKey[2]}.json`,
  );
  const data = await response.json();
  return data;
};
export const PreferencesByRegion: FC<{
  region?: string;
}> = ({ region }) => {
  const { selected } = useElectionContext();
  const { data: preferences } = useQuery({
    queryKey: ["preferences_by_municipality", selected, region],
    queryFn,
  });
  return preferences && region ? (
    <PreferencesTable
      preferences={preferences}
      region={region}
      visibleColumns={["candidate"]}
    />
  ) : null;
};
