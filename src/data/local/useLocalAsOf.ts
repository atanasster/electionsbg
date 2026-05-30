// Anchor the local-elections dashboards to the selected parliamentary
// election. Reads ElectionContext.selected and resolves the regular local
// cycle in effect at that moment (see localAsOf).

import { useMemo } from "react";
import { useElectionContext } from "@/data/ElectionContext";
import { localAsOf, type LocalAsOf } from "./localAsOf";

export const useLocalAsOf = (): LocalAsOf => {
  const { selected } = useElectionContext();
  return useMemo(() => localAsOf(selected), [selected]);
};
