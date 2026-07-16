// Municipal-waste recycling + per-capita generation (Eurostat cei_wm011 /
// env_wasmun), for the /sector/environment waste-vs-target tile. Tiny annual JSON
// written by scripts/environment/fetch_waste.ts; fetched client-side with
// staleTime:Infinity (same class as data/cofog.json).

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export interface WastePoint {
  year: number;
  value: number;
}

export interface WasteFile {
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  /** Waste Framework Directive 2018/851 recycling targets (% of municipal waste). */
  targets: { y2025: number; y2030: number; y2035: number };
  recyclingRate: { unit: string; byGeo: Record<string, WastePoint[]> };
  wastePerCapita: { unit: string; byGeo: Record<string, WastePoint[]> };
}

const fetchWaste = async (): Promise<WasteFile> => {
  const r = await fetch(dataUrl("/environment/waste.json"));
  if (!r.ok) throw new Error("waste fetch failed");
  return r.json();
};

export const useWaste = () =>
  useQuery({
    queryKey: ["environment", "waste"],
    queryFn: fetchWaste,
    staleTime: Infinity,
  });
