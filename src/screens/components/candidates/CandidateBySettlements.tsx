import { PreferencesInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { FC } from "react";
import { PreferencesTable } from "../preferences/PreferencesTable";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | undefined]
>): Promise<PreferencesInfo[] | null> => {
  if (!queryKey[1] || !queryKey[2]) {
    return null;
  }
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/candidates/${queryKey[2]}/settlements.json`),
  );
  const data = await response.json();
  return data;
};
export const CandidateBySettlements: FC<{
  name: string;
  /** Filter to the resolved candidate's party — the name folder holds every namesake's rows. */
  partyNum?: number | null;
}> = ({ name, partyNum }) => {
  const { selected } = useElectionContext();
  const { data: preferences } = useQuery({
    queryKey: ["candidate_preferences_by_settlements", selected, name],
    queryFn,
  });
  const rows =
    partyNum != null && preferences
      ? preferences.filter((p) => p.partyNum === partyNum)
      : preferences;
  return rows ? (
    <PreferencesTable
      preferences={rows}
      region=""
      visibleColumns={["oblast", "obshtina", "ekatte"]}
    />
  ) : null;
};
