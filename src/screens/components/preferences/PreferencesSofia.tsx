import { PreferencesInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { PreferencesTable } from "./PreferencesTable";
import { FC, useMemo } from "react";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  PreferencesInfo[] | null
> => {
  if (!queryKey[1]) {
    return null;
  }
  const response = await fetch(`/${queryKey[1]}/preferences/sofia.json`);
  const data = await response.json();
  return data;
};
export const PreferencesSofia: FC = () => {
  const { selected } = useElectionContext();
  const { data: preferences } = useQuery({
    queryKey: ["preferences_sofia", selected],
    queryFn,
  });
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
      visibleColumns={["oblast", "candidate"]}
      regionPrefs={regions}
    />
  ) : null;
};
