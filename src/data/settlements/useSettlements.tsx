import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { SettlementInfo } from "../dataTypes";

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
    (e?: string) => (e ? settlements?.find((s) => s.ekatte == e) : undefined),
    [settlements],
  );

  return {
    findSettlement,
  };
};
