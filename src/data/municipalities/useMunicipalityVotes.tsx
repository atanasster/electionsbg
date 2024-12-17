import { ElectionMunicipality } from "../dataTypes";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | undefined | null]
>): Promise<ElectionMunicipality | undefined> => {
  if (!queryKey[1]) {
    return undefined;
  }
  const response = await fetch(
    `/${queryKey[1]}/municipalities/${queryKey[2]}.json`,
  );
  const data = await response.json();
  return data;
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
