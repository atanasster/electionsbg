import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

export type LocationInfo = {
  ekatte: string;
  name: string;
  name_en: string;
  dx?: string;
  dy?: string;
};
export type RegionInfo = LocationInfo & {
  oblast: string;
  region: string;
  nuts3: string;
};

export type MunicipalityInfo = LocationInfo & {
  obshtina: string;
  nuts3: string;
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
