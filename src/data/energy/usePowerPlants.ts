// Bulgaria's power-plant fleet (asset-level), from data/energy/plants.json (built
// by scripts/energy/build_plants.ts — curated from Global Energy Monitor + the
// contracts corpus). Full-history, scope-independent.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { PowerPlantsFile } from "./types";

export const usePowerPlants = () =>
  useQuery({
    queryKey: ["energy", "plants"] as const,
    queryFn: async (): Promise<PowerPlantsFile> => {
      const r = await fetch(dataUrl("/energy/plants.json"));
      if (!r.ok) throw new Error(`energy plants fetch failed: ${r.status}`);
      return r.json();
    },
    staleTime: Infinity,
  });
