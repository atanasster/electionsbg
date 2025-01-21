import { PreferencesInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { PreferencesTable } from "./PreferencesTable";
import { FC } from "react";
import { useSettlementStats } from "@/data/settlements/useSettlementStats";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | undefined]
>): Promise<PreferencesInfo[] | undefined> => {
  if (!queryKey[1] || !queryKey[2]) {
    return undefined;
  }
  const response = await fetch(
    `/${queryKey[1]}/preferences/by_settlement/${queryKey[2]}.json`,
  );
  const data = await response.json();
  return data;
};
export const PreferencesBySettlement: FC<{
  ekatte?: string;
  region?: string;
}> = ({ ekatte, region }) => {
  const { selected } = useElectionContext();
  const { data: preferences } = useQuery({
    queryKey: ["preferences_by_settlement", selected, ekatte],
    queryFn,
  });
  const { stats } = useSettlementStats(ekatte);
  return preferences && region ? (
    <PreferencesTable
      preferences={preferences}
      region={region}
      stats={stats?.find((s) => s.name === selected)}
    />
  ) : null;
};
