// Household electricity price — Bulgaria vs EU27 — from data/energy/prices.json
// (built by scripts/energy/fetch_prices.ts off Eurostat nrg_pc_204). Bi-annual,
// all taxes, EUR/kWh. Full-history, scope-independent.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export interface PricePoint {
  period: string; // e.g. "2025-S2"
  value: number; // EUR/kWh
}

export interface EnergyPrices {
  updated: string;
  source: string;
  sourceUrl: string;
  unit: string;
  latest: string;
  series: { BG: PricePoint[]; EU27: PricePoint[] };
}

export const useEnergyPrices = () =>
  useQuery({
    queryKey: ["energy", "prices"] as const,
    queryFn: async (): Promise<EnergyPrices> => {
      const r = await fetch(dataUrl("/energy/prices.json"));
      if (!r.ok) throw new Error(`energy prices fetch failed: ${r.status}`);
      return r.json();
    },
    staleTime: Infinity,
  });
