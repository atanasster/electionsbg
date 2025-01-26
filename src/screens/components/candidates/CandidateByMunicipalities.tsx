import { PreferencesInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { FC } from "react";
import { PreferencesTable } from "../preferences/PreferencesTable";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | undefined]
>): Promise<PreferencesInfo[] | null> => {
  if (!queryKey[1] || !queryKey[2]) {
    return null;
  }
  const response = await fetch(
    `/${queryKey[1]}/candidates/${queryKey[2]}/municipalities.json`,
  );
  const data = await response.json();
  return data;
};
export const CandidateByMunicipalities: FC<{
  name: string;
}> = ({ name }) => {
  const { selected } = useElectionContext();
  const { data: preferences } = useQuery({
    queryKey: ["candidate_preferences_by_municipalities", selected, name],
    queryFn,
  });
  return preferences ? (
    <PreferencesTable
      preferences={preferences}
      region=""
      visibleColumns={["oblast", "obshtina"]}
    />
  ) : null;
};
