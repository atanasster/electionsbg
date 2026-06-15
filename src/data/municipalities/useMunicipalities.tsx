import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { MunicipalityInfo } from "../dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async (): Promise<MunicipalityInfo[]> => {
  const response = await fetch(dataUrl("/municipalities.json"));
  const data = await response.json();
  return data;
};

// `enabled` mirrors useSettlementsInfo: defer the municipalities.json fetch
// until needed. Defaults true so existing always-need-it callers are unchanged.
export const useMunicipalities = (enabled = true) => {
  const { data: municipalities } = useQuery({
    queryKey: ["municipalities"],
    queryFn: queryFn,
    enabled,
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
