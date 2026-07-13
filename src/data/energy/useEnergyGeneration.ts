// Bulgaria electricity generation mix / net trade / carbon intensity, from
// data/energy/generation.json (built by scripts/energy/fetch_generation.ts off
// Ember's Yearly Electricity Data, CC BY 4.0). Full-history, scope-independent —
// a physical-system series, not a procurement window.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { EnergyGeneration } from "./types";

export type { EnergyYear, EnergyGeneration } from "./types";

export const useEnergyGeneration = () =>
  useQuery({
    queryKey: ["energy", "generation"] as const,
    queryFn: async (): Promise<EnergyGeneration> => {
      const r = await fetch(dataUrl("/energy/generation.json"));
      if (!r.ok) throw new Error(`energy generation fetch failed: ${r.status}`);
      return r.json();
    },
    staleTime: Infinity,
  });
