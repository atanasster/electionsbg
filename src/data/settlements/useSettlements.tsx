import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { SettlementInfo } from "../dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async (): Promise<SettlementInfo[]> => {
  const response = await fetch(dataUrl("/settlements.json"));
  const data = await response.json();
  return data;
};

// `enabled` lets callers defer the ~940 KB settlements.json fetch until the
// data is actually needed (e.g. the global header only needs it once the
// area popover opens or an anchor is set). Defaults true so the dozens of
// place-detail callers that always need it are unchanged.
export const useSettlementsInfo = (enabled = true) => {
  const { data: settlements } = useQuery({
    queryKey: ["settlements"],
    queryFn: queryFn,
    enabled,
  });

  const findSettlement = useCallback(
    (e?: string) => (e ? settlements?.find((s) => s.ekatte == e) : undefined),
    [settlements],
  );

  return {
    findSettlement,
    settlements,
  };
};
