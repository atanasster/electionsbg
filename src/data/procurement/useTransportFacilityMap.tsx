// Data hook for the /sector/transport marker map. ONE
// /api/db/transport-facility-map call returns the МТС-group entities geolocated
// to their facility town (via the static transport_facility_geo crosswalk,
// schema 132) with the windowed contracts corpus already folded server-side —
// spend, contract count and single-bid share per entity. The client just
// renders points; no browser geocoding. Mirrors useMvrDirectorateMap.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import type { ScopeWindow } from "./useAwarderContracts";
import type { TransportUniverse } from "@/lib/transportReferenceData";

export type { ScopeWindow };

/** One geolocated transport entity with its windowed procurement metric. */
export interface TransportFacilityPoint {
  eik: string;
  name: string;
  universe: TransportUniverse | null;
  oblast: string | null;
  settlement: string | null;
  municipality: string | null;
  /** [lng, lat] — the entity's facility-town centroid. */
  loc: [number, number];
  totalEur: number;
  contractCount: number;
  bidKnownN: number;
  singleBidN: number;
}

interface FacilityMapPayload {
  facilities: TransportFacilityPoint[];
}

const EMPTY: TransportFacilityPoint[] = [];

export const useTransportFacilityMap = (
  eiks: readonly string[],
  windowOverride?: ScopeWindow,
): { facilities: TransportFacilityPoint[]; isLoading: boolean } => {
  const urlWindow = useScopeWindow();
  const from = windowOverride ? windowOverride.from : urlWindow.from;
  const to = windowOverride ? windowOverride.to : urlWindow.to;
  const eikParam = useMemo(() => [...eiks].join(","), [eiks]);

  const { data, isLoading } = useQuery({
    queryKey: ["db", "transport-facility-map", eikParam, from, to] as const,
    queryFn: async (): Promise<FacilityMapPayload | null> => {
      const pr = new URLSearchParams({ eiks: eikParam });
      if (from) pr.set("from", from);
      if (to) pr.set("to", to);
      const r = await fetch(`/api/db/transport-facility-map?${pr.toString()}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: eiks.length > 0,
    staleTime: Infinity,
  });

  // Guard the loc shape: the SQL fn always emits a [lng, lat] pair, but a
  // crosswalk row missing a point is filtered server-side — belt-and-braces on
  // the client too.
  const facilities = useMemo<TransportFacilityPoint[]>(() => {
    const rows = data?.facilities ?? EMPTY;
    return rows.filter(
      (d) =>
        Array.isArray(d.loc) &&
        Number.isFinite(d.loc[0]) &&
        Number.isFinite(d.loc[1]),
    );
  }, [data]);

  return { facilities, isLoading };
};
