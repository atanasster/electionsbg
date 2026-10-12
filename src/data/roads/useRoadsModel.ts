// The roads engine model over the WHOLE roll-up (ROADS_SECTOR_EIKS — АПИ +
// НКСИП), scoped to the page's window. The /sector/roads sub-pages read this.
//
// Why not useRoads: that hook models ONE awarder and also fetches the
// counterparty rollup, which the roads sub-pages never render. The hub blob
// (db:gen-roads-hub-stats) models the roll-up, so a sub-page modelling АПИ alone
// would put a different Струма total one click under the hub's (€208.9M of
// НКСИП's €220.7M is Струма; the engine places €3.9M on Хемус and leaves the
// rest without a corridor) — the same number, two buyer sets.
//
// Each EIK is fetched through the shared awarderContractsQuery, so the cache key
// is the one every other awarder surface uses and a sub-page → sub-page hop
// refetches nothing.

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import {
  awarderContractsQuery,
  scopeByWindow,
} from "@/data/procurement/useAwarderContracts";
import { buildRoadsModel, type RoadsModel } from "@/lib/roadAttributes";
import { ROADS_SECTOR_EIKS } from "@/lib/roadsReferenceData";
import type { ProcurementContract } from "@/data/dataTypes";

export interface RoadsModelData {
  model: RoadsModel | null;
  isLoading: boolean;
  /** Some buyer's rows failed to load — the model would silently be partial. */
  isError: boolean;
}

export const useRoadsModel = (): RoadsModelData => {
  const { from, to } = useScopeWindow();
  const results = useQueries({
    queries: ROADS_SECTOR_EIKS.map((eik) => awarderContractsQuery(eik)),
  });
  // isPending, not isLoading: a query paused offline is pending but not
  // loading, and would otherwise build a partial model from the EIKs that did load.
  const isLoading = results.some((r) => r.isPending);
  // A null body is a failed fetch (fetchAwarderContracts returns null on !ok).
  const isError = results.some(
    (r) => r.isError || (r.isSuccess && r.data == null),
  );
  const datas = results.map((r) => r.data);

  const model = useMemo(() => {
    if (isLoading || isError) return null;
    const rows: ProcurementContract[] = datas.flatMap(
      (d) => d?.contracts ?? [],
    );
    return buildRoadsModel(scopeByWindow(rows, from, to));
    // `datas` is a fresh array every render; key on the payload identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isError, from, to, ...datas]);

  return { model, isLoading, isError };
};
