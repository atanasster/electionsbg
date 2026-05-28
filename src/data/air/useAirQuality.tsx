// Air-quality monitoring stations from EEA + ИАОС. Empty until
// `update-air-quality` runs (see scripts/air/README.md).

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type Pollutant = "pm10" | "pm25" | "no2" | "o3" | "so2";

export type AirStation = {
  id: string;
  name: string;
  obshtina: string;
  loc: string;
  latestReadings: Partial<Record<Pollutant, number>>;
  history7d?: Partial<Record<Pollutant, number[]>>;
};

export type AirFile = {
  source: string;
  indexName: string;
  pollutants: Record<
    Pollutant,
    { bg: string; en: string; unit: string; euLimit: number }
  >;
  stations: AirStation[];
  snapshotAsOf: string | null;
  note?: string;
};

const fetchAir = async (): Promise<AirFile> => {
  const r = await fetch(dataUrl("/air/index.json"));
  if (!r.ok) throw new Error("air fetch failed");
  return r.json();
};

export const useAirQuality = (obshtina?: string | null) => {
  const { data } = useQuery({
    queryKey: ["air"],
    queryFn: fetchAir,
    staleTime: Infinity,
  });
  const stations = obshtina
    ? (data?.stations.filter((s) => s.obshtina === obshtina) ?? [])
    : [];
  return { data, stations };
};
