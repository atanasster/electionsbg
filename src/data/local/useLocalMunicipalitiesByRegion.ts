// Fan out useLocalMunicipality across every município in a parliamentary
// region (MIR / izborni rayon). Used by the oblast Local-control tile on
// RegionDashboardCards to roll up mayors-won + council-seat composition
// across the region.
//
// Reuses the same per-município queryKey as useLocalMunicipality
// (`["local_municipality", cycle, code]`), so a user who has already
// clicked into one of these municípios — or who later does — shares the
// React-Query cache: a cached município reads instantly here, and the
// drill-down navigation reads instantly there.
//
// For the prior-cycle comparison we also accept a `priorCycle` arg and
// fan out a parallel set of fetches. Same sharing applies on the prior
// side via useLocalMunicipality(_, priorCycle).

import { useQueries } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useMunicipalitiesByRegion } from "@/data/municipalities/useMunicipalitiesByRegion";
import { useLatestLocalCycle } from "./useLatestLocalCycle";
import { LocalMunicipalityBundle } from "./types";

const fetchBundle = async (
  cycle: string,
  obshtinaCode: string,
): Promise<LocalMunicipalityBundle | undefined> => {
  const response = await fetch(
    dataUrl(`/${cycle}/municipalities/${obshtinaCode}.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `local municipality fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

type Row = {
  obshtinaCode: string;
  bundle: LocalMunicipalityBundle | undefined;
  priorBundle: LocalMunicipalityBundle | undefined;
};

export const useLocalMunicipalitiesByRegion = (
  regionCode: string,
  priorCycle?: string,
): { rows: Row[]; isLoading: boolean } => {
  const cycle = useLatestLocalCycle();
  const munis = useMunicipalitiesByRegion(regionCode) ?? [];
  const codes = munis.map((m) => m.obshtina);

  const currentQueries = useQueries({
    queries: codes.map((code) => ({
      queryKey: ["local_municipality", cycle, code],
      queryFn: async () => fetchBundle(cycle, code),
      enabled: !!code,
    })),
  });

  // Prior-cycle fan-out — when no priorCycle is requested we issue an
  // empty queries array so we don't register `enabled:false` entries
  // with a synthetic empty-string cycle key. Those entries don't fetch
  // but they DO pollute the React-Query cache and would diverge from
  // the canonical `["local_municipality", cycle, code]` key that
  // useLocalMunicipality emits — so consumers that later look up the
  // same código via useLocalMunicipality wouldn't dedupe against them.
  const priorQueries = useQueries({
    queries: priorCycle
      ? codes.map((code) => ({
          queryKey: ["local_municipality", priorCycle, code],
          queryFn: async () => fetchBundle(priorCycle, code),
          enabled: !!code,
        }))
      : [],
  });

  const rows: Row[] = codes.map((code, i) => ({
    obshtinaCode: code,
    bundle: currentQueries[i].data,
    priorBundle: priorQueries[i]?.data,
  }));

  const isLoading = currentQueries.some((q) => q.isLoading);

  return { rows, isLoading };
};
