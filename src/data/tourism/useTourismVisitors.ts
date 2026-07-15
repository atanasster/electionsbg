// Real Bulgaria tourism visitor stats (Eurostat tour_occ_nim), served as a
// static blob at /tourism/visitors.json — the honest visitor-outcome context
// beside the Ministry of Tourism's procurement on /sector/tourism. Same pattern
// as the culture / budget hooks: dataUrl() seam, staleTime Infinity, 404 → null.
// Generated offline by scripts/tourism/fetch_eurostat_tourism.ts.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export interface TourismSeasonMonth {
  month: number; // 1–12
  foreign: number; // nights spent by non-residents
  domestic: number; // nights spent by residents
}

export interface TourismOriginMarket {
  code: string; // ISO 2-letter
  name: string; // English label from Eurostat
  nights: number; // nights spent in BG by guests from this country
}

export interface TourismVisitorsFile {
  source: { publisher: string; dataset: string; url: string; note: string };
  generatedAt: string;
  unit: string;
  seasonalityYear: number;
  peakMonth: number;
  summerShareForeign: number; // Jun–Sep share of the year's foreign nights
  winterShareForeign: number; // Dec–Mar share
  seasonality: TourismSeasonMonth[];
  annualForeign: { year: number; nights: number }[];
  sourceMarketsYear: number;
  sourceMarketsForeignTotal: number; // that year's total foreign nights (share base)
  sourceMarkets: TourismOriginMarket[]; // top origin countries, nights desc
}

export const useTourismVisitors = () =>
  useQuery({
    queryKey: ["tourism", "visitors"] as const,
    queryFn: async (): Promise<TourismVisitorsFile | null> => {
      const r = await fetch(dataUrl("/tourism/visitors.json"));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
      return (await r.json()) as TourismVisitorsFile;
    },
    staleTime: Infinity,
  });
