import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// Top-level COFOG-99 functions plus the rolled-up TOTAL the dataset emits.
// Matches scripts/macro/fetch_cofog.ts.
export const COFOG_CODES = [
  "GF01",
  "GF02",
  "GF03",
  "GF04",
  "GF05",
  "GF06",
  "GF07",
  "GF08",
  "GF09",
  "GF10",
  "TOTAL",
] as const;
export type CofogCode = (typeof COFOG_CODES)[number];

// Pre-filtered list of just the 10 function codes (excludes TOTAL) for tile
// rendering — TOTAL is the denominator, not a renderable slice.
export const COFOG_FUNCTIONS: ReadonlyArray<Exclude<CofogCode, "TOTAL">> = [
  "GF01",
  "GF02",
  "GF03",
  "GF04",
  "GF05",
  "GF06",
  "GF07",
  "GF08",
  "GF09",
  "GF10",
];

export type CofogPoint = { year: number; valueEur: number };

export type CofogPayload = {
  fetchedAt: string;
  source: {
    name: string;
    dataset: string;
    url: string;
    unit: string;
    sector: string;
    filters: Record<string, string>;
  };
  cofogTopLevel: CofogCode[];
  latestYear: number;
  series: Record<CofogCode, CofogPoint[]>;
};

export const useCofog = () =>
  useQuery({
    queryKey: ["cofog"],
    queryFn: async (): Promise<CofogPayload | undefined> => {
      const res = await fetch(dataUrl("/cofog.json"));
      if (!res.ok) return undefined;
      return (await res.json()) as CofogPayload;
    },
    staleTime: Infinity,
  });
