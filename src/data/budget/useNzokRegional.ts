// Per-oblast (РЗОК) aggregation of НЗОК hospital-care payments for the regional
// choropleth. НЗОК reports БМП payments by РЗОК (28 regional funds ≈ the 28
// oblasti); this joins each РЗОК to the region-map's canonical oblast bucket and
// to regional.json population, so the map can show absolute spend AND spend per
// resident — the per-capita view that turns raw € into a comparable rate (and the
// map the single-year competitor lacks entirely).
//
// Reuses the procurement choropleth's already-solved oblast plumbing
// (provinceToCanon / featureToCanon + the Sofia/Plovdiv split handling): the only
// НЗОК-specific twist is the РЗОК label "София град", which the region map calls
// "София (столица)".

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  provinceToCanon,
  featureToCanon,
  fetchPopulation,
} from "@/data/procurement/useProcurementByOblast";
import type { NzokHospitalPaymentsFile } from "./types";

export type NzokOblastMetric = "total" | "perCapita";

export type NzokOblastBucket = {
  code: string;
  name: string;
  totalEur: number;
  facilityCount: number;
  /** Resident population (persons); 0 when unknown. */
  population: number;
};

// РЗОК display name → canonical oblast bucket. Every РЗОК name matches a
// regions.json `name` verbatim (so provinceToCanon resolves it — incl. "Пловдив"→
// PDV and "София област"→SFO) EXCEPT "София град", which the region map labels
// "София (столица)".
const rzokNameToCanon = (name: string): string | undefined =>
  name === "София град"
    ? provinceToCanon("София (столица)")
    : provinceToCanon(name);

export const useNzokRegional = (
  data: NzokHospitalPaymentsFile | null,
): {
  buckets: Map<string, NzokOblastBucket>;
  valueFor: (
    featureCode: string,
    metric: NzokOblastMetric,
  ) => number | undefined;
} => {
  const { data: population } = useQuery({
    queryKey: ["regional_population"] as const,
    queryFn: fetchPopulation,
    staleTime: Infinity,
  });

  const buckets = useMemo(() => {
    const out = new Map<string, NzokOblastBucket>();
    if (!data) return out;
    for (const r of data.byRzok) {
      const code = rzokNameToCanon(r.name);
      if (!code) continue;
      const b = out.get(code) ?? {
        code,
        name: r.name,
        totalEur: 0,
        facilityCount: 0,
        population: 0,
      };
      b.totalEur += r.cumulativeEur;
      b.facilityCount += r.facilityCount;
      out.set(code, b);
    }
    // Population per bucket. The regional series stores Sofia's three МИР
    // (S23/S24/S25) each holding the FULL Sofia-city population, and PDV/PDV-00
    // each the FULL Plovdiv-oblast population — duplicates, not parts. Take the
    // MAX across a bucket's member feature codes, never the sum (else Sofia's
    // per-capita comes out 3× too low). Mirrors useProcurementByOblast.
    if (population) {
      const popByCanon = new Map<string, number>();
      for (const [featCode, pop] of Object.entries(population)) {
        const canon = featureToCanon(featCode);
        popByCanon.set(canon, Math.max(popByCanon.get(canon) ?? 0, pop));
      }
      for (const [code, b] of out) b.population = popByCanon.get(code) ?? 0;
    }
    return out;
  }, [data, population]);

  const valueFor = useMemo(() => {
    return (
      featureCode: string,
      metric: NzokOblastMetric,
    ): number | undefined => {
      const b = buckets.get(featureToCanon(featureCode));
      if (!b) return undefined;
      if (metric === "total") return b.totalEur;
      return b.population > 0 ? b.totalEur / b.population : undefined;
    };
  }, [buckets]);

  return { buckets, valueFor };
};
