// Култура (МК) pack hook — the Ministry of Culture procurement corpus, scoped to
// the host awarder page's [from, to) window and fed to buildKulturaModel. No
// budget bridge (the МК ministry page owns budget/programs/execution — plan §1),
// so this is deliberately thinner than useVss/useNzok: just the contract model.

import { useMemo } from "react";
import { useAwarderGroupModel, type ScopeWindow } from "./useAwarderGroupModel";
import {
  buildKulturaModelFromAggregates,
  KULTURA_EIK,
} from "@/lib/kulturaAttributes";
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
  const eiks = useMemo(() => [eik], [eik]);
  const gm = useAwarderGroupModel(
    eiks,
    buildKulturaModelFromAggregates,
    windowOverride,
  );
  return { model: gm.model, isLoading: gm.isLoading };
};
