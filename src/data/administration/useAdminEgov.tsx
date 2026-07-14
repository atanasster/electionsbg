import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// e-government adoption — Eurostat isoc_ciegi_ac (I_IUGOV1). Small artifact
// built by scripts/administration/fetch_egov.ts: BG + EU27 + peer set, so the
// /sector/administration screen can show where Bulgaria stands in Europe on
// digital public-service use.

export interface EgovPoint {
  year: number;
  value: number;
}

export interface EgovPayload {
  indicator: {
    dataset: string;
    code: string;
    titleBg: string;
    titleEn: string;
    unit: string;
  };
  source: { name: string; url: string };
  fetchedAt: string;
  latestYear: number;
  byGeo: Record<string, EgovPoint[]>;
}

export const useAdminEgov = () =>
  useQuery({
    queryKey: ["administration", "egov"] as const,
    queryFn: async (): Promise<EgovPayload | undefined> => {
      const res = await fetch(dataUrl("/administration/egov.json"));
      if (!res.ok) return undefined;
      return (await res.json()) as EgovPayload;
    },
    staleTime: Infinity,
  });
