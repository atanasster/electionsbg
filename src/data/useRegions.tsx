import regions from "../data/json/regions.json";
import { RegionInfo } from "./useSettlements";
import { useCallback } from "react";

export const useRegions = () => {
  const findRegion: (e: string) => RegionInfo | undefined = useCallback(
    (e: string) => regions?.find((s) => s.oblast == e),
    [],
  );
  return {
    findRegion,
  };
};
