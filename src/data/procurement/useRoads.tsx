// Data hook for the АПИ road-spending dashboard (/procurement/roads) —
// DB-backed. The full per-contract row set comes from /api/db/awarder-contracts
// (АПИ ≈ 2.1k rows) and feeds the pure roadAttributes engine; the headline
// rollup (totals + byContractor) is derived from the same rows plus the
// grouped counterparty list, so no static JSON shard is involved.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCounterparties } from "./useCounterparties";
import {
  buildRoadsModel,
  API_EIK,
  type RoadsModel,
} from "@/lib/roadAttributes";
import type { ProcurementContract } from "@/data/dataTypes";

// Re-exported so existing importers (tiles, RoadsScreen) keep their path; the
// canonical literal now lives in the dependency-free engine. See roadAttributes.
export { API_EIK };

/** The slice of the old awarder rollup the roads dashboard actually renders. */
export interface RoadsRollup {
  eik: string;
  name: string;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  byContractor: Array<{
    eik: string;
    name: string;
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
  }>;
}

export interface RoadsData {
  rollup: RoadsRollup | null | undefined;
  model: RoadsModel | null;
  isLoading: boolean;
}

const fetchAwarderContracts = async (
  eik: string,
): Promise<{ contracts: ProcurementContract[] } | null> => {
  const r = await fetch(
    `/api/db/awarder-contracts?eik=${encodeURIComponent(eik)}`,
  );
  if (!r.ok) return null;
  return (await r.json()) as { contracts: ProcurementContract[] };
};

export const useAwarderContracts = (eik?: string | null) =>
  useQuery({
    queryKey: ["db", "awarder-contracts", eik] as const,
    queryFn: () => fetchAwarderContracts(eik as string),
    enabled: !!eik && /^\d{9,13}$/.test(eik),
    staleTime: Infinity,
    retry: false,
  });

export const useRoads = (eik: string = API_EIK): RoadsData => {
  const counterparties = useCounterparties(eik, "awarder");
  const contracts = useAwarderContracts(eik);

  const model = useMemo(
    () => (contracts.data ? buildRoadsModel(contracts.data.contracts) : null),
    [contracts.data],
  );

  // Headline totals are DERIVED by summing the counterparty groups — exact
  // only because company-counterparties is uncapped by design (documented in
  // functions/db_routes.js). If that route ever gains a LIMIT, this must
  // switch to an authoritative rollup total or the АПИ headline will silently
  // under-report.
  const rollup = useMemo<RoadsRollup | null>(() => {
    const cp = counterparties.data;
    if (!cp || cp.entries.length === 0) return null;
    const totalOther: Record<string, number> = {};
    let totalEur = 0;
    let contractCount = 0;
    for (const e of cp.entries) {
      totalEur += e.totalEur;
      contractCount += e.contractCount;
      for (const [cur, v] of Object.entries(e.totalOther ?? {}))
        totalOther[cur] = (totalOther[cur] ?? 0) + v;
    }
    return {
      eik: cp.eik,
      name: cp.name ?? `ЕИК ${cp.eik}`,
      totalEur,
      totalOther,
      contractCount,
      byContractor: cp.entries,
    };
  }, [counterparties.data]);

  return {
    rollup,
    model,
    isLoading: counterparties.isLoading || contracts.isLoading,
  };
};
