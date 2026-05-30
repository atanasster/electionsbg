import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import { ElectionSettlement } from "../dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined, string]>): Promise<
  ElectionSettlement[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/settlements/by/${queryKey[2]}.json`),
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

// Same fetch keyed on an explicit election date — used to load the prior cycle
// so we can compute per-settlement shifts (gainer/loser) for the SettlementsMap
// shift-arrows toggle. Mirrors `useMunicipalitiesByRegionFor`.
export const useSettlementsByMunicipalityFor = (
  obshtina: string,
  electionDate?: string | null,
) => {
  const { data } = useQuery({
    queryKey: ["settlements_by_municipality", electionDate ?? "", obshtina],
    queryFn,
    enabled: !!electionDate && !!obshtina,
  });
  return data;
};
