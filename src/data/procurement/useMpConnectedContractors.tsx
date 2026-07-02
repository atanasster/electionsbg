// MP-connected contractor index — DB-backed via the shared risk-indexes
// payload (useRiskIndexes). The risk scorer needs presence (`.has(eik)`);
// the roads dashboard also reads the MPs behind each tied contractor.

import { useMemo } from "react";
import { useRiskIndexes } from "./useRiskIndexes";

export type MpConnectedMp = { mpId: number; mpName: string };

export type MpConnectedContractorsIndex = {
  /** Contractor EIK → the MPs declared as its officers/owners. */
  byContractorEik: Map<string, MpConnectedMp[]>;
};

const EMPTY: MpConnectedContractorsIndex = { byContractorEik: new Map() };

export const useMpConnectedContractors = (): {
  index: MpConnectedContractorsIndex;
  isLoading: boolean;
} => {
  const { data, isLoading } = useRiskIndexes();

  const index = useMemo<MpConnectedContractorsIndex>(() => {
    if (!data) return EMPTY;
    const byContractorEik = new Map<string, MpConnectedMp[]>();
    for (const e of data.mpConnected) {
      const arr = byContractorEik.get(e.eik) ?? [];
      if (!arr.some((m) => m.mpId === e.mpId))
        arr.push({ mpId: e.mpId, mpName: e.mpName });
      byContractorEik.set(e.eik, arr);
    }
    return { byContractorEik };
  }, [data]);

  return { index, isLoading };
};
