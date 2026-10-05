// Which children a presidential place page ranks and maps, and whether the „Топ …" geography
// tile would have anything to draw — split from the tile so its section gate can ask without
// mounting it (`DashboardSection` cannot see through a self-hiding child).
//
// ⚠ THE CHILDREN ARE THE MAP'S FEATURES, NOT A CODE PREFIX: oblast codes do not prefix their
// municipalities reliably (`PDV-00` vs `PDV`, Sofia's `S23xx`), so the set is read off the same
// geometry the map draws, and React Query hands the tile and the map one download.

import { useMemo } from "react";
import { useMunicipalitiesMap } from "@/data/municipalities/useMunicipalitiesMap";
import { useSettlementsMap } from "@/data/settlements/useSettlementsMap";
import { useRoundRollup } from "./useRoundRollup";
import type {
  MunicipalityJSONProps,
  SettlementJSONProps,
} from "@/screens/components/maps/mapTypes";

export type ChildGrain = "municipality" | "settlement";

/** Which children a parent has, as the map draws them — `null` until the geometry loads. */
export const useChildKeys = (
  parentId: string,
  grain: ChildGrain,
): Set<string> | null => {
  const isMuni = grain === "municipality";
  // ⚠ BOTH CALLED UNCONDITIONALLY (hook order); each is a no-op on an empty argument.
  const muniGeo = useMunicipalitiesMap(isMuni ? parentId : "");
  const settlementGeo = useSettlementsMap(isMuni ? undefined : parentId);
  return useMemo(() => {
    const geo = isMuni ? muniGeo : settlementGeo;
    const features = Array.isArray(geo?.features) ? geo.features : null;
    if (!features) return null;
    return new Set(
      features.map((f: { properties: unknown }) =>
        isMuni
          ? (f.properties as MunicipalityJSONProps).nuts4
          : (f.properties as SettlementJSONProps).ekatte,
      ),
    );
  }, [isMuni, muniGeo, settlementGeo]);
};

/** Whether the tile would draw anything — the gate a `DashboardSection` heading needs, since
 *  the section cannot see through the tile's own self-hide. Same inputs, so React Query
 *  dedupes the requests. */
export const useHasChildTop = (
  cycle: string,
  round: 1 | 2,
  parentId: string | undefined,
  grain: ChildGrain | undefined,
): boolean => {
  const rollup = useRoundRollup(
    grain ? cycle : undefined,
    round,
    grain ?? "municipality",
  );
  const keys = useChildKeys(parentId ?? "", grain ?? "municipality");
  return useMemo(() => {
    if (!grain || !parentId || rollup.status !== "ready" || !keys) return false;
    return rollup.rollup.entries.some(
      (e) => keys.has(e.key) && e.results.votes.some((v) => v.totalVotes > 0),
    );
  }, [grain, parentId, rollup, keys]);
};
