// Contractor EIK → incorporation date, from the shared risk-indexes payload
// (useRiskIndexes → foundedByEik). Backs the newFirmWinner risk flag: a company
// that won a contract shortly after being formed. Same shape/gating as
// usePepConnectedEikSet — the risk scorer needs an O(1) lookup, and a missing
// payload must leave the flag UNAVAILABLE (not "available + never fires").

import { useMemo } from "react";
import { useRiskIndexes } from "./useRiskIndexes";

export const useCompanyFoundedByEik = (): {
  byEik: Map<string, string>;
  isLoading: boolean;
  isLoaded: boolean;
} => {
  const { data, isLoading } = useRiskIndexes();
  const byEik = useMemo(
    () => new Map(Object.entries(data?.foundedByEik ?? {})),
    [data],
  );
  return { byEik, isLoading, isLoaded: data != null };
};
