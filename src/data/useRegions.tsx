import regions from "../data/json/regions.json";
import { useCallback } from "react";

export const useRegions = () => {
  const findRegion = useCallback(
    (e?: string) => (e ? regions?.find((s) => s.oblast == e) : undefined),
    [],
  );
  return {
    findRegion,
  };
};
