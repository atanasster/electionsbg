import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

export type LocationInfo = {
  ekatte: string;
  name: string;
  name_en: string;
  nuts3: string;
  dx?: string;
  dy?: string;
};
export type RegionInfo = LocationInfo & {
  oblast: string;
  region: string;
};

export type MunicipalityInfo = LocationInfo & {
  obshtina: string;
};
export type SettlementInfo = LocationInfo & {
  t_v_m: string;
  oblast: string;
  obshtina: string;
  kmetstvo: string;
};

const queryFn = async (): Promise<SettlementInfo[]> => {
  const response = await fetch("/settlements.json");
  const data = await response.json();
  return data;
};

export const useSettlementsInfo = () => {
  const { data: settlements } = useQuery({
    queryKey: ["settlements"],
    queryFn: queryFn,
  });

  const findSettlement = useCallback(
    (e: string) => settlements?.find((s) => s.ekatte == e),
    [settlements],
  );

  return {
    findSettlement,
  };
};
