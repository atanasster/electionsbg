import regions from "../json/regions.json";
import { useCallback } from "react";
import { RegionInfo } from "../dataTypes";

export const useRegions = () => {
  const findRegion = useCallback(
    (e?: string) =>
      (e ? regions?.find((s) => s.oblast == e) : undefined) as
        | RegionInfo
        | undefined,
    [],
  );
  return {
    findRegion,
  };
};
