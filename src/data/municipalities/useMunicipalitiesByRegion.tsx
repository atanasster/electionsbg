import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { ElectionMunicipality } from "../dataTypes";
import { useElectionContext } from "../ElectionContext";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined, string]>): Promise<
  ElectionMunicipality[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(
    `/${queryKey[1]}/municipalities/by/${queryKey[2]}.json`,
  );
  const data = await response.json();
  return data;
};

export const useMunicipalitiesByRegion = (region: string) => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["settlements_by_municipality", selected, region],
    queryFn,
    enabled: !!selected,
  });
  return data;
};

export const useMunicipalitiesByRegionFor = (
  region: string,
  electionDate?: string | null,
) => {
  const { data } = useQuery({
    queryKey: ["settlements_by_municipality", electionDate ?? "", region],
    queryFn,
    enabled: !!electionDate && !!region,
  });
  return data;
};
