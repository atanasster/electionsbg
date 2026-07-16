// Data hook for the Транспорт infrastructure map on /sector/transport. ONE
// /api/db/transport-project-map call returns the physical infrastructure NAMED in the
// transport group's contract titles, in two shapes, geolocated via the static
// transport_project_link crosswalk (schema 076), with the windowed contracts corpus already
// folded server-side (spend, contract count, single-bid share):
//
//   • segments — rail sections between two towns (drawn as lines)
//   • points   — single-site stations / ports / junctions (drawn as typed markers)
//
// The client just renders; no browser geocoding, no per-EIK fan-out.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import type { ScopeWindow } from "./useAwarderContracts";

export type { ScopeWindow };

type FacilityType = "rail" | "port" | "station" | "junction";

interface ProjectMetric {
  totalEur: number;
  contractCount: number;
  bidKnownN: number;
  singleBidN: number;
}

/** A funded rail section between two towns (drawn as a line). */
export interface TransportProjectSegment extends ProjectMetric {
  /** [lng, lat] endpoints. */
  a: [number, number];
  b: [number, number];
  aTown: string;
  bTown: string;
}

/** A single-site facility named in ≥1 contract (drawn as a typed marker). */
export interface TransportProjectPoint extends ProjectMetric {
  town: string;
  /** [lng, lat] — the town centroid. */
  loc: [number, number];
  facility: FacilityType | null;
}

interface ProjectMapPayload {
  segments: TransportProjectSegment[];
  points: TransportProjectPoint[];
}

const EMPTY_SEG: TransportProjectSegment[] = [];
const EMPTY_PT: TransportProjectPoint[] = [];

const finiteLoc = (l: unknown): l is [number, number] =>
  Array.isArray(l) && Number.isFinite(l[0]) && Number.isFinite(l[1]);

export const useTransportProjectMap = (
  eiks: readonly string[],
  windowOverride?: ScopeWindow,
): {
  segments: TransportProjectSegment[];
  points: TransportProjectPoint[];
  isLoading: boolean;
} => {
  const urlWindow = useScopeWindow();
  const from = windowOverride ? windowOverride.from : urlWindow.from;
  const to = windowOverride ? windowOverride.to : urlWindow.to;
  const eikParam = useMemo(() => [...eiks].join(","), [eiks]);

  const { data, isLoading } = useQuery({
    queryKey: ["db", "transport-project-map", eikParam, from, to] as const,
    queryFn: async (): Promise<ProjectMapPayload | null> => {
      const pr = new URLSearchParams({ eiks: eikParam });
      if (from) pr.set("from", from);
      if (to) pr.set("to", to);
      const r = await fetch(`/api/db/transport-project-map?${pr.toString()}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: eiks.length > 0,
    staleTime: Infinity,
  });

  const segments = useMemo<TransportProjectSegment[]>(
    () =>
      (data?.segments ?? EMPTY_SEG).filter(
        (s) => finiteLoc(s.a) && finiteLoc(s.b),
      ),
    [data],
  );
  const points = useMemo<TransportProjectPoint[]>(
    () => (data?.points ?? EMPTY_PT).filter((p) => finiteLoc(p.loc)),
    [data],
  );

  return { segments, points, isLoading };
};
