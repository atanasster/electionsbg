import { ElectionMunicipality } from "../dataTypes";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import { dataUrl } from "@/data/dataUrl";
import { fetchJsonSoft } from "../fetchJson";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | undefined | null]
>): Promise<ElectionMunicipality | undefined> => {
  if (!queryKey[1]) {
    return undefined;
  }
  const data = await fetchJsonSoft<ElectionMunicipality>(
    dataUrl(`/${queryKey[1]}/municipalities/${queryKey[2]}.json`),
  );
  return data ?? undefined;
};

export const useMunicipalityVotes = (obshtina?: string | null) => {
  const { selected } = useElectionContext();
  const { data: municipality } = useQuery({
    queryKey: ["municipality_votes", selected, obshtina],
    queryFn,
    enabled: !!obshtina,
  });

  return {
    municipality,
  };
};
