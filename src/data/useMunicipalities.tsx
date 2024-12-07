import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { MunicipalityInfo } from "./dataTypes";

const queryFn = async (): Promise<MunicipalityInfo[]> => {
  const response = await fetch("/municipalities.json");
  const data = await response.json();
  return data;
};

export const useMunicipalities = () => {
  const { data: municipalities } = useQuery({
    queryKey: ["municipalities"],
    queryFn: queryFn,
  });
  const findMunicipality = useCallback(
    (m?: string) => {
      return m ? municipalities?.find((s) => s.obshtina == m) : undefined;
    },
    [municipalities],
  );
  return {
    findMunicipality,
  };
};
