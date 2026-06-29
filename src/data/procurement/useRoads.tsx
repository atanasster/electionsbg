// Data hook for the АПИ road-spending dashboard (/procurement/roads). Loads the
// АПИ awarder rollup (headline money, matches the site) + its per-contract rows
// (for the road-attribute breakdowns) and runs the pure roadAttributes engine.

import { useMemo } from "react";
import { useAwarder, useAwarderContracts } from "./useAwarder";
import { buildRoadsModel, type RoadsModel } from "./roadAttributes";
import type { ProcurementAwarderRollup } from "@/data/dataTypes";

/** АПИ — Агенция "Пътна инфраструктура". Single legal entity; the 28 ОПУ file
 *  under this EIK as buyer sub-units. See awarder_identity.ts. */
export const API_EIK = "000695089";

export interface RoadsData {
  rollup: ProcurementAwarderRollup | null | undefined;
  model: RoadsModel | null;
  isLoading: boolean;
}

export const useRoads = (eik: string = API_EIK): RoadsData => {
  const rollup = useAwarder(eik);
  const contracts = useAwarderContracts(eik);
  const model = useMemo(
    () => (contracts.data ? buildRoadsModel(contracts.data.contracts) : null),
    [contracts.data],
  );
  return {
    rollup: rollup.data,
    model,
    isLoading: rollup.isLoading || contracts.isLoading,
  };
};
