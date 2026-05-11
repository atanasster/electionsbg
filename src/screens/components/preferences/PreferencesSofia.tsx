import { PreferencesInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { PreferencesTable } from "./PreferencesTable";
import { FC } from "react";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  PreferencesInfo[] | null
> => {
  if (!queryKey[1]) {
    return null;
  }
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/preferences/sofia.json`),
  );
  const data = await response.json();
  return data;
};
export const PreferencesSofia: FC = () => {
  const { selected } = useElectionContext();
  const { data: preferences } = useQuery({
    queryKey: ["preferences_sofia", selected],
    queryFn,
  });

  return preferences ? (
    <PreferencesTable
      preferences={preferences}
      region=""
      visibleColumns={["oblast", "candidate"]}
    />
  ) : null;
};
