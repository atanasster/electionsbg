// River-cleaning / flood-maintenance spend — the Tier-A half of the flood-risk
// feature (docs/plans/water-view-v1.md §4.5b). One small committed file written
// by scripts/water/write_flood_maintenance.ts from the procurement corpus
// (contracts for почистване/корекция на речни корита и дерета). Static-JSON
// served like the judiciary data (dataUrl seam, staleTime Infinity).

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export interface FloodYear {
  year: number;
  eur: number;
  count: number;
}
export interface FloodAwarder {
  eik: string;
  name: string;
  eur: number;
  count: number;
}
export interface FloodContract {
  key: string;
  title: string;
  awarderEik: string;
  awarderName: string;
  contractorEik: string;
  contractorName: string;
  eur: number;
  date: string;
}
export interface FloodMaintenanceFile {
  source: string;
  totalEur: number;
  contractCount: number;
  awarderCount: number;
  napoitelniEur: number;
  napoitelniCount: number;
  byYear: FloodYear[];
  topAwarders: FloodAwarder[];
  topContracts: FloodContract[];
}

export const useFloodMaintenance = () =>
  useQuery({
    queryKey: ["water", "flood_maintenance"] as const,
    queryFn: async (): Promise<FloodMaintenanceFile> => {
      const res = await fetch(dataUrl("/water/flood_maintenance.json"));
      if (!res.ok) throw new Error(`flood_maintenance -> ${res.status}`);
      return res.json();
    },
    staleTime: Infinity,
  });
