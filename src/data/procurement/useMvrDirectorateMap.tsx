// Data hook for the Полиция / МВР marker map on /sector/security. ONE
// /api/db/mvr-directorate-map call returns the МВР budget units geolocated to their
// HQ town (via the static mvr_directorate_geo crosswalk, schema 074) with the
// windowed contracts corpus already folded on server-side — spend, contract count
// and single-bid share per structure. The client just renders points; no browser
// geocoding, no per-EIK fan-out. Mirrors useAwarderGroupModel's scope window.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import type { ScopeWindow } from "./useAwarderContracts";
import type { SecurityUniverse } from "@/lib/securityReferenceData";

export type { ScopeWindow };

/** One geolocated МВР structure with its windowed procurement metric. */
export interface MvrDirectoratePoint {
  eik: string;
  name: string;
  universe: SecurityUniverse | null;
  oblast: string | null;
  settlement: string | null;
  municipality: string | null;
  /** [lng, lat] — the structure's HQ town centroid. */
  loc: [number, number];
  totalEur: number;
  contractCount: number;
  bidKnownN: number;
  singleBidN: number;
}

interface DirectorateMapPayload {
  directorates: MvrDirectoratePoint[];
}

const EMPTY: MvrDirectoratePoint[] = [];

export const useMvrDirectorateMap = (
  eiks: readonly string[],
  windowOverride?: ScopeWindow,
): { directorates: MvrDirectoratePoint[]; isLoading: boolean } => {
  const urlWindow = useScopeWindow();
  const from = windowOverride ? windowOverride.from : urlWindow.from;
  const to = windowOverride ? windowOverride.to : urlWindow.to;
  const eikParam = useMemo(() => [...eiks].join(","), [eiks]);

  const { data, isLoading } = useQuery({
    queryKey: ["db", "mvr-directorate-map", eikParam, from, to] as const,
    queryFn: async (): Promise<DirectorateMapPayload | null> => {
      const pr = new URLSearchParams({ eiks: eikParam });
      if (from) pr.set("from", from);
      if (to) pr.set("to", to);
      const r = await fetch(`/api/db/mvr-directorate-map?${pr.toString()}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: eiks.length > 0,
    staleTime: Infinity,
  });

  // Guard the loc shape: the SQL fn always emits a [lng, lat] pair, but a crosswalk
  // row missing a point is filtered server-side — belt-and-braces on the client too.
  const directorates = useMemo<MvrDirectoratePoint[]>(() => {
    const rows = data?.directorates ?? EMPTY;
    return rows.filter(
      (d) =>
        Array.isArray(d.loc) &&
        Number.isFinite(d.loc[0]) &&
        Number.isFinite(d.loc[1]),
    );
  }, [data]);

  return { directorates, isLoading };
};
