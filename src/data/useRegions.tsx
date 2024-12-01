import regions from "../data/json/regions.json";
import { useCallback } from "react";

export const useRegions = () => {
  const findRegion = useCallback(
    (e: string) => regions?.find((s) => s.oblast == e),
    [],
  );
  return {
    findRegion,
  };
};
