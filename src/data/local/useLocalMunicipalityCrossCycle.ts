// Per-município cross-cycle council trends. Reads the precomputed per-município
// council shard (data/local_place_trends/m/<obshtina>.json — built from each
// cycle's bundle.council by build_local_place_trends.ts) and reshapes it into
// the shared `CrossCycleData`. This replaces the old per-cycle bundle fan-out
// (useLocalMunicipalityHistory), which loaded the whole município bundle for
// every cycle just to read the council summary — ~800KB–1.5MB on big-city
// pages vs ~4KB now. Party display name + colour are resolved through
// useCanonicalParties (see placeCouncilToCrossCycle), so the chart stays
// language-aware. Sofia райони use the section-derived `p/` shard instead and
// never call this hook (their council tile is gated off).

import {
  placeCouncilToCrossCycle,
  useLocalPlaceTrend,
  usePlaceCouncilResolver,
} from "./useLocalPlaceTrends";
import { CrossCycleData } from "./crossCycleShape";

export const useLocalMunicipalityCrossCycle = (
  obshtinaCode?: string | null,
  topN = 6,
): { data?: CrossCycleData; isLoading: boolean } => {
  const { data: file, isLoading } = useLocalPlaceTrend("m", obshtinaCode);
  const resolve = usePlaceCouncilResolver();
  const data = file
    ? placeCouncilToCrossCycle(file.trend, file.cyclesAsc, resolve, topN)
    : undefined;
  return { data, isLoading };
};
