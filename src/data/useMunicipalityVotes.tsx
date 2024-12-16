import { useCallback } from "react";
import { ElectionMunicipality } from "./dataTypes";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "./ElectionContext";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  ElectionMunicipality[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(`/${queryKey[1]}/municipality_votes.json`);
  const data = await response.json();
  return data;
};

export const useMunicipalityVotes = () => {
  const { selected } = useElectionContext();
  const { data: municipalities } = useQuery({
    queryKey: ["municipality_votes", selected],
    queryFn,
  });

  const votesByMunicipality = useCallback(
    (obshtina: string): ElectionMunicipality | undefined => {
      return municipalities?.find((m) => m.obshtina === obshtina);
    },
    [municipalities],
  );
  const municipalitiesByRegion = useCallback(
    (oblast: string): ElectionMunicipality[] | undefined => {
      return municipalities?.filter((m) => m.oblast === oblast);
    },
    [municipalities],
  );
  return {
    municipalitiesByRegion,
    votesByMunicipality,
  };
};
