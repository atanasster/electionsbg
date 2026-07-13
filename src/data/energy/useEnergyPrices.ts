// Household electricity price — Bulgaria vs EU27 — from data/energy/prices.json
// (built by scripts/energy/fetch_prices.ts off Eurostat nrg_pc_204). Bi-annual,
// all taxes, EUR/kWh. Full-history, scope-independent.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { EnergyPrices } from "./types";

export type { PricePoint, EnergyPrices } from "./types";

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
