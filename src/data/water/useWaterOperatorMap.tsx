// Geolocated ВиК operators for the marker map at the top of /water — one point per
// operator HQ city, coloured by single-bidder-contract share (the awarder-pack risk
// metric), badge = contract count. Served from Postgres (schema 073) in ONE
// scope-aware call (water_operator_map) rather than geocoding in the browser: the fn
// folds the windowed contracts corpus per operator EIK onto the baked water_operator_geo
// crosswalk (EIK → awarder_seats → settlements.json centroid). Windowed CLIENT-driven to
// the host page's [from, to) procurement scope, same as the /water pack (useVik).

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { WATER_SECTOR_EIKS, operatorByEik } from "@/lib/vikReferenceData";

/** One geolocated operator with its windowed procurement metric. */
export interface WaterOperatorPoint {
  eik: string;
  /** Canonical operator label (from vikReferenceData, not the corpus variants). */
  name: string;
  /** Resolved HQ settlement · município · oblast (from awarder_seats). */
  settlement: string | null;
  municipality: string | null;
  oblast: string | null;
  /** [lng, lat] centroid (only geolocated operators are returned by the fn). */
  loc: [number, number];
  contractCount: number;
  totalEur: number;
  bidKnownN: number;
  singleBidN: number;
  /** Single-bidder share among contracts with a known tenderer count; null if none
   *  carry a count. Drives the marker colour. */
  singleBidShare: number | null;
}

interface Payload {
  operators: Array<{
    eik: string;
    settlement: string | null;
    municipality: string | null;
    oblast: string | null;
    loc: [number, number];
    contractCount: number;
    totalEur: number;
    bidKnownN: number;
    singleBidN: number;
  }>;
}

const EIK_PARAM = WATER_SECTOR_EIKS.join(",");

export const useWaterOperatorMap = (): {
  operators: WaterOperatorPoint[];
  isLoading: boolean;
} => {
  const { from, to } = useScopeWindow();

  const { data, isLoading } = useQuery({
    queryKey: ["db", "water-operator-map", from, to] as const,
    queryFn: async (): Promise<Payload> => {
      const p = new URLSearchParams({ eiks: EIK_PARAM });
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      const r = await fetch(`/api/db/water-operator-map?${p.toString()}`);
      if (!r.ok) return { operators: [] };
      return r.json();
    },
    staleTime: Infinity,
  });

  const operators = useMemo<WaterOperatorPoint[]>(
    () =>
      (data?.operators ?? []).map((o) => ({
        eik: o.eik,
        name: operatorByEik(o.eik)?.name ?? `ЕИК ${o.eik}`,
        settlement: o.settlement,
        municipality: o.municipality,
        oblast: o.oblast,
        loc: o.loc,
        contractCount: o.contractCount,
        totalEur: o.totalEur,
        bidKnownN: o.bidKnownN,
        singleBidN: o.singleBidN,
        singleBidShare: o.bidKnownN > 0 ? o.singleBidN / o.bidKnownN : null,
      })),
    [data],
  );

  return { operators, isLoading };
};
