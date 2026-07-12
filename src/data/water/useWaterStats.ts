// НСИ water-services statistics — the national воден-режим share (population
// under water rationing), water-supply connection and wastewater-treatment
// connection, by year. One small committed file written by
// scripts/water/write_water_stats.ts from the NSI "Относителен дял на населението
// с водни услуги" timeseries. Static-JSON served like the flood artifact.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export interface WaterStatsYear {
  year: number;
  connectedWaterPct: number | null;
  wasteTreatmentPct: number | null;
  rationingPct: number | null;
  rationingSeasonalPct: number | null;
  rationingYearRoundPct: number | null;
}
export interface WaterStatsFile {
  source: string;
  sourceUrl: string;
  unit: string;
  latestYear: number | null;
  years: WaterStatsYear[];
}

export const useWaterStats = () =>
  useQuery({
    queryKey: ["water", "water_stats"] as const,
    queryFn: async (): Promise<WaterStatsFile> => {
      const res = await fetch(dataUrl("/water/water_stats.json"));
      if (!res.ok) throw new Error(`water_stats -> ${res.status}`);
      return res.json();
    },
    staleTime: Infinity,
  });
