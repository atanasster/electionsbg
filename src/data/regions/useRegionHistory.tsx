import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { RegionHistory } from "./regionHistoryTypes";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  RegionHistory | undefined
> => {
  if (!queryKey[1]) return undefined;
  const response = await fetch(`/regions/${queryKey[1]}_history.json`);
  if (!response.ok) return undefined;
  return response.json();
};

export const regionHistoryQueryKey = (
  regionCode: string,
): [string, string | null | undefined] => ["region_history", regionCode];
export const regionHistoryQueryFn = queryFn;

export const useRegionHistory = (regionCode?: string | null) => {
  return useQuery({
    queryKey: regionHistoryQueryKey(regionCode ?? ""),
    queryFn,
    enabled: !!regionCode,
  });
};
