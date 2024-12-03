import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { MunicipalityGeoJSON } from "./mapTypes";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  MunicipalityGeoJSON | undefined
> => {
  if (!queryKey[1]) {
    return undefined;
  }
  const response = await fetch(`/maps/regions/${queryKey[1]}.json`);
  const data = await response.json();
  return data;
};
export const useMunicipalitiesMap = (region: string) => {
  const { data } = useQuery({
    queryKey: ["municipalities_map", region],
    queryFn: queryFn,
  });

  return data;
};
