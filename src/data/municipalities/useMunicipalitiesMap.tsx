import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { MunicipalityGeoJSON } from "../../screens/components/maps/mapTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  MunicipalityGeoJSON | undefined
> => {
  if (!queryKey[1]) {
    return undefined;
  }
  const response = await fetch(dataUrl(`/maps/regions/${queryKey[1]}.json`));
  const data = await response.json();
  return data;
};
export const useMunicipalitiesMap = (region: string) => {
  const { data } = useQuery({
    queryKey: ["municipalities_map", region],
    queryFn: queryFn,
    // ⚠ An empty region is how a caller that must call this hook unconditionally (hook order)
    // says „not this grain" — running the query anyway makes React Query log an error for the
    // `undefined` it returns, as `useSettlementsMap` already avoids.
    enabled: !!region,
  });

  return data;
};
