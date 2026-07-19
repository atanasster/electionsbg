// Household energy prices — Bulgaria vs EU27 vs neighbour peers — built by
// scripts/energy/fetch_prices.ts off Eurostat. Bi-annual, all taxes, EUR/kWh.
// Full-history, scope-independent. Electricity = nrg_pc_204 (prices.json), natural
// gas = nrg_pc_202 (gas_prices.json); both share the EnergyPrices shape.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { EnergyPrices } from "./types";

export type { PricePoint, EnergyPrices } from "./types";

const useEnergyPricesFile = (kind: "prices" | "gas_prices", label: string) =>
  useQuery({
    queryKey: ["energy", kind] as const,
    queryFn: async (): Promise<EnergyPrices> => {
      const r = await fetch(dataUrl(`/energy/${kind}.json`));
      if (!r.ok) throw new Error(`energy ${label} fetch failed: ${r.status}`);
      return r.json();
    },
    staleTime: Infinity,
  });

export const useEnergyPrices = () =>
  useEnergyPricesFile("prices", "electricity prices");

export const useGasPrices = () =>
  useEnergyPricesFile("gas_prices", "gas prices");
