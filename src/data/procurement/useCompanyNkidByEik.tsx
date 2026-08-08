// Contractor EIK → declared НКИД (NACE) 2-digit division, from the shared
// risk-indexes payload (useRiskIndexes → nkidByEik). Backs the nkidMismatch risk
// flag: a firm winning a contract whose CPV is disjoint from its declared line of
// business. Same shape/gating as useCompanyFoundedByEik — the risk scorer needs an
// O(1) lookup, and a missing payload must leave the flag UNAVAILABLE (not
// "available + never fires").

import { useMemo } from "react";
import { useRiskIndexes } from "./useRiskIndexes";

export const useCompanyNkidByEik = (): {
  byEik: Map<string, string>;
  isLoading: boolean;
  isLoaded: boolean;
} => {
  const { data, isLoading } = useRiskIndexes();
  const byEik = useMemo(
    () => new Map(Object.entries(data?.nkidByEik ?? {})),
    [data],
  );
  return { byEik, isLoading, isLoaded: data != null };
};
