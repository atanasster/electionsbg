// Bulgarian + EU-average consumer fuel prices (Euro-super 95, automotive diesel)
// from the EU Weekly Oil Bulletin, written by scripts/consumption/fetch_fuel.ts
// into data/fuel.json (EUR/L, weekly, VAT-inclusive). Served like macro.json.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export interface FuelPoint {
  date: string;
  bg95: number | null;
  bgDiesel: number | null;
  eu95: number | null;
  euDiesel: number | null;
}
export interface FuelFile {
  source: string;
  sourceUrl: string;
  unit: string;
  note: string;
  latestDate: string;
  series: FuelPoint[];
}

export const useFuel = () =>
  useQuery({
    queryKey: ["fuel"],
    queryFn: async (): Promise<FuelFile | undefined> => {
      const res = await fetch(dataUrl("/fuel.json"));
      if (!res.ok) return undefined;
      return (await res.json()) as FuelFile;
    },
    staleTime: Infinity,
  });
