// Култура (МК) pack hook — the Ministry of Culture procurement corpus, scoped to
// the host awarder page's [from, to) window and fed to buildKulturaModel. No
// budget bridge (the МК ministry page owns budget/programs/execution — plan §1),
// so this is deliberately thinner than useVss/useNzok: just the contract model.

import { useMemo } from "react";
import {
  useAwarderContracts,
  scopeByWindow,
  type ScopeWindow,
} from "./useAwarderContracts";
import { useProcurementWindow } from "./useProcurementWindow";
import { buildKulturaModel, KULTURA_EIK } from "@/lib/kulturaAttributes";
import type { KulturaModel } from "@/lib/kulturaAttributes";

export type { ScopeWindow };

export interface KulturaData {
  model: KulturaModel | null;
  isLoading: boolean;
}

export const useKultura = (
  eik: string = KULTURA_EIK,
  windowOverride?: ScopeWindow,
): KulturaData => {
  const contracts = useAwarderContracts(eik);
  const urlWindow = useProcurementWindow();
  const from = windowOverride ? windowOverride.from : urlWindow.from;
  const to = windowOverride ? windowOverride.to : urlWindow.to;

  const model = useMemo<KulturaModel | null>(() => {
    const all = contracts.data?.contracts;
    if (!all) return null;
    return buildKulturaModel(scopeByWindow(all, from, to));
  }, [contracts.data, from, to]);

  return { model, isLoading: contracts.isLoading };
};
