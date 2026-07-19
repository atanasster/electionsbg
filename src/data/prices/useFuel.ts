// Bulgarian + EU-average consumer fuel prices (Euro-super 95, automotive diesel)
// from the EU Weekly Oil Bulletin, written by scripts/consumption/fetch_fuel.ts
// into data/fuel.json (EUR/L, weekly, VAT-inclusive). Served like macro.json.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// Canonical geo code shared with the macro peer set (BG anchor, EU27 benchmark,
// four neighbour peers). Greece is Eurostat's EL → GR here.
export type FuelGeo = "BG" | "EU27_2020" | "RO" | "GR" | "HU" | "HR";

// One weekly row: the €/L price of each fuel per geo. Values are sparse — a peer
// can be missing for a given week (e.g. Croatia before its 2013 accession).
export interface FuelPoint {
  date: string;
  petrol: Partial<Record<FuelGeo, number | null>>;
  diesel: Partial<Record<FuelGeo, number | null>>;
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
