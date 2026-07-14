import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// The precomputed serving blob for /sector/administration (built by
// scripts/administration/build_context.ts). Bakes the exact slices the page
// needs from personnel.json + macro.json + cofog.json so the page fetches ~8 KB
// instead of ~324 KB. See the build script header for the derivation.

export interface AdminPositions {
  total: number;
  central: number | null;
  territorial: number | null;
  municipal: number | null;
  filled: number | null;
  vacant: number | null;
  vacantOverSixMonths: number | null;
}

export interface AdminNationalYear {
  positions: AdminPositions;
  structureCounts: {
    central: Record<string, number>;
    territorial: Record<string, number>;
  };
}

export interface Gf01Point {
  year: number;
  valueEur: number;
  pctGdp: number | null;
  perCapita: number | null;
}

export interface AdminContext {
  generatedAt: string;
  cofogLatestYear: number;
  national: Record<string, AdminNationalYear>;
  costByYear: Record<string, Array<{ adminId: string; eur: number }>>;
  population: Array<{ year: number; value: number }>;
  gf01: {
    series: Gf01Point[];
    euCompare: {
      year: number;
      band: {
        bgPctGdp: number;
        euAvgPctGdp: number | null;
        rank: number;
        total: number;
      } | null;
      bars: Array<{ geo: string; pct: number }>;
    };
  };
}

export const useAdminContext = () =>
  useQuery({
    queryKey: ["administration", "context"] as const,
    queryFn: async (): Promise<AdminContext | undefined> => {
      const res = await fetch(dataUrl("/administration/context.json"));
      if (!res.ok) return undefined;
      return (await res.json()) as AdminContext;
    },
    staleTime: Infinity,
  });
