import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { MunicipalityInfo } from "../dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async (): Promise<MunicipalityInfo[]> => {
  const response = await fetch(dataUrl("/municipalities.json"));
  const data = await response.json();
  return data;
};

export const useMunicipalities = () => {
  const { data: municipalities } = useQuery({
    queryKey: ["municipalities"],
    queryFn: queryFn,
  });
  const findMunicipality = useCallback(
    (m?: string | null) => {
      return m ? municipalities?.find((s) => s.obshtina == m) : undefined;
    },
    [municipalities],
  );
  return {
    municipalities,
    findMunicipality,
  };
};
