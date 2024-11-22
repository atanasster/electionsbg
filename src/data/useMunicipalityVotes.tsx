import { useCallback } from "react";
import { ElectionMunicipality } from "./dataTypes";
import { useQuery } from "@tanstack/react-query";

const queryFn = async (): Promise<ElectionMunicipality[]> => {
  const response = await fetch("/2024_10/municipality_votes.json");
  const data = await response.json();
  return data;
};
export const useMunicipalitydVotes = () => {
  const { data: municipalities } = useQuery({
    queryKey: ["municipality_votes"],
    queryFn,
  });

  const votesByMunicipality = useCallback(
    (obshtina: string): ElectionMunicipality | undefined => {
      return municipalities?.find((m) => m.obshtina === obshtina);
    },
    [municipalities],
  );

  return {
    votesByMunicipality,
    municipalities,
  };
};
