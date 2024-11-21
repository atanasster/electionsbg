import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

export type LocationInfo = {
  oblast: string;
  ekatte: string;
  name: string;
  name_en: string;
  nuts1: string;
  nuts2: string;
  nuts3: string;
};
export type RegionInfo = LocationInfo & {
  ekatte: string;
  name: string;
  name_en: string;
  region: string;
  document: string;
  full_name_bul: string;
};

export type MunicipalityInfo = LocationInfo & {
  obshtina: string;
  category: number;
  document: number;
  full_name_bul: string;
};
export type SettlementInfo = LocationInfo & {
  t_v_m: string;
  kmetstvo: string;
  kind: number;
  category: number;
  altitude: number;
  document: 2007;
  abc: number;
  text: string;
  obshtina: string;
  oblast_name: string;
  obshtina_name: string;
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
