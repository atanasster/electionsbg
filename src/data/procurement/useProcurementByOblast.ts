// Per-oblast procurement aggregation for the choropleth. Built client-side
// from the committed by_settlement index (local-tier procurement, keyed by
// settlement province name) joined to:
//   - regions.json (province name → oblast code, the key the region map uses)
//   - regional.json `series.population` (oblast-code → population, for per-capita)
//
// Sofia city and Plovdiv each render as several map features (S23/S24/S25 for
// Sofia city; PDV + PDV-00 for Plovdiv); we aggregate to a single canonical
// bucket per oblast and resolve every feature code back to its bucket so the
// whole region colours consistently. National-tier procurement (ministries) is
// excluded by the index — correct, since a ministry's nationwide spending can't
// be pinned to its Sofia HQ oblast.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import regions from "@/data/json/regions.json";
import { dataUrl } from "@/data/dataUrl";
import { useProcurementBySettlementIndex } from "./useSettlementProcurement";

export type OblastMetric = "total" | "perCapita" | "avg";

export type OblastBucket = {
  code: string;
  name: string;
  totalEur: number;
  contractCount: number;
  awarderCount: number;
  /** Resident population (persons), summed across member feature codes. */
  population: number;
};

const SOFIA_CITY = "SOFIA_CITY";

// Index province names that don't match a regions.json `name` verbatim.
const PROVINCE_OVERRIDES: Record<string, string> = {
  София: "SFO", // Sofia province — regions.json calls it "София област"
  "София (столица)": SOFIA_CITY, // Sofia city — split into S23/S24/S25 features
};

// Map a region-map feature code back to its canonical procurement bucket.
export const featureToCanon = (code: string): string => {
  if (code === "S23" || code === "S24" || code === "S25") return SOFIA_CITY;
  if (code === "PDV-00") return "PDV";
  return code;
};

// Province name (as it appears in the by_settlement index) → oblast code.
// Built once from the static regions.json import.
const NAME_TO_CODE = new Map<string, string>(
  (regions as Array<{ name: string; oblast: string }>).map((r) => [
    r.name,
    r.oblast,
  ]),
);

// Resolve a settlement's `province` string to its canonical oblast bucket
// code — the same key the choropleth buckets use. Lets the table filter
// itself when a region is clicked on the map. Returns undefined for
// provinces we can't place (kept out of the map anyway).
export const provinceToCanon = (province: string): string | undefined => {
  const raw = PROVINCE_OVERRIDES[province] ?? NAME_TO_CODE.get(province);
  return raw ? featureToCanon(raw) : undefined;
};

type PopSeries = Record<string, Array<{ year: number; value: number }>>;

const fetchPopulation = async (): Promise<Record<string, number>> => {
  const r = await fetch(dataUrl("/regional.json"));
  if (!r.ok) return {};
  const d = (await r.json()) as { series?: { population?: PopSeries } };
  const pop = d.series?.population ?? {};
  const out: Record<string, number> = {};
  // Latest year's value, ×1000 (the series is in thousands of persons).
  for (const [code, arr] of Object.entries(pop)) {
    const last = arr[arr.length - 1];
    if (last) out[code] = last.value * 1000;
  }
  return out;
};

export const useProcurementByOblast = (): {
  buckets: Map<string, OblastBucket>;
  /** Value for one region-map feature code under the selected metric. */
  valueFor: (featureCode: string, metric: OblastMetric) => number | undefined;
  isLoading: boolean;
} => {
  const { data: idx, isLoading } = useProcurementBySettlementIndex();
  const { data: population } = useQuery({
    queryKey: ["regional_population"] as const,
    queryFn: fetchPopulation,
    staleTime: Infinity,
  });

  const codeToName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of regions as Array<{ name: string; oblast: string }>) {
      m.set(r.oblast, r.name);
    }
    m.set(SOFIA_CITY, "София (столица)");
    return m;
  }, []);

  const buckets = useMemo(() => {
    const out = new Map<string, OblastBucket>();
    if (!idx) return out;
    for (const s of idx.settlements) {
      // Normalise to the canonical bucket: regions.json keys Plovdiv as
      // "обл. Пловдив"→PDV AND "Пловдив"→PDV-00, and the index uses "Пловдив",
      // so the raw lookup yields "PDV-00" — a bucket no feature code resolves
      // to (featureToCanon folds PDV-00→PDV). provinceToCanon folds it here
      // too so the Plovdiv oblast isn't stranded as no-data.
      const code = provinceToCanon(s.province);
      if (!code) continue;
      const b = out.get(code) ?? {
        code,
        name: codeToName.get(code) ?? s.province,
        totalEur: 0,
        contractCount: 0,
        awarderCount: 0,
        population: 0,
      };
      b.totalEur += s.totalEur;
      b.contractCount += s.contractCount;
      b.awarderCount += s.awarderCount;
      out.set(code, b);
    }
    // Attach population: sum of member feature codes' population per bucket.
    if (population) {
      const popByCanon = new Map<string, number>();
      for (const [featCode, pop] of Object.entries(population)) {
        const canon = featureToCanon(featCode);
        popByCanon.set(canon, (popByCanon.get(canon) ?? 0) + pop);
      }
      for (const [code, b] of out) b.population = popByCanon.get(code) ?? 0;
    }
    return out;
  }, [idx, population, codeToName]);

  const valueFor = useMemo(() => {
    return (featureCode: string, metric: OblastMetric): number | undefined => {
      const b = buckets.get(featureToCanon(featureCode));
      if (!b) return undefined;
      if (metric === "total") return b.totalEur;
      if (metric === "avg")
        return b.contractCount > 0 ? b.totalEur / b.contractCount : undefined;
      // perCapita
      return b.population > 0 ? b.totalEur / b.population : undefined;
    };
  }, [buckets]);

  return { buckets, valueFor, isLoading };
};
