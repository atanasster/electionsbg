import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { SettlementGeoJSON } from "../../screens/components/maps/mapTypes";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  SettlementGeoJSON | undefined
> => {
  if (!queryKey[1]) {
    return undefined;
  }
  const response = await fetch(`/maps/municipalities/${queryKey[1]}.json`);
  const data = await response.json();
  return data;
};

export const useSettlementsMap = (municipality?: string) => {
  const { data } = useQuery({
    queryKey: ["settlements_map", municipality],
    queryFn: queryFn,
    enabled: !!municipality,
  });

  return data;
};
