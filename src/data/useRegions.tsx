import { useQuery } from "@tanstack/react-query";
import { RegionInfo } from "./useSettlements";
import { useCallback } from "react";

const queryFn = async (): Promise<RegionInfo[]> => {
  const response = await fetch("/regions.json");
  const data = await response.json();
  return data;
};

export const useRegions = () => {
  const { data: regions } = useQuery({
    queryKey: ["regions"],
    queryFn: queryFn,
  });

  const findRegion = useCallback(
    (e: string) => regions?.find((s) => s.oblast == e),
    [regions],
  );
  return {
    findRegion,
  };
};
