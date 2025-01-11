import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import { ElectionSettlement } from "../dataTypes";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined, string]>): Promise<
  ElectionSettlement[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(
    `/${queryKey[1]}/settlements/by/${queryKey[2]}.json`,
  );
  const data = await response.json();
  return data;
};

export const useSettlementsByMunicipality = (obshtina: string) => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["settlements_by_municipality", selected, obshtina],
    queryFn,
    enabled: !!selected,
  });
  return data;
};
