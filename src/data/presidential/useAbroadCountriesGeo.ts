// Every country with a Bulgarian polling station, as ONE feature collection — the six
// per-continent geometry files (`maps/municipalities/<continent>.json`) the parliamentary
// continent pages already load, merged.
//
// ⚠ IT IS THE COUNTRY→CONTINENT CROSSWALK AS WELL AS THE GEOMETRY: each feature's `ekatte` is
// the country's ISO-2 key (the presidential abroad roll-up's key, Kosovo's Cyrillic `КО`
// included) and its `nuts4` the continent.
//
// ⚠ NO GEOMETRY UNTIL ALL SIX HAVE ANSWERED. A map drawn from five of them would show a
// continent's countries as „no station" — a false statement about named places — while the
// sixth was merely still in flight. A file that fails stays failed rather than being skipped,
// and `failed` says so, so the caller can stop showing a loading state for data that will not
// arrive.

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { SettlementGeoJSON } from "@/screens/components/maps/mapTypes";

export const ABROAD_CONTINENTS = ["AF", "AS", "EU", "NA", "OC", "SA"] as const;

const fetchContinent = async (code: string): Promise<SettlementGeoJSON> => {
  const res = await fetch(dataUrl(`/maps/municipalities/${code}.json`));
  if (!res.ok) throw new Error(`continent geometry ${code}: ${res.status}`);
  return res.json();
};

export const useAbroadCountriesGeo = (): {
  geo: SettlementGeoJSON | undefined;
  failed: boolean;
} => {
  const results = useQueries({
    queries: ABROAD_CONTINENTS.map((code) => ({
      // ⚠ THE SAME KEY `useSettlementsMap` USES, so a reader arriving from a parliamentary
      // continent page reuses that download.
      queryKey: ["settlements_map", code],
      queryFn: () => fetchContinent(code),
    })),
  });
  const parts = results.map((r) => r.data);
  // ⚠ MEMOISED ON THE SIX DATA REFERENCES — the map's projection is memoised on this object, so
  // a fresh one per render would re-project the world on every hover.
  const geo = useMemo(() => {
    if (!parts.every((d) => d && Array.isArray(d.features))) return undefined;
    return {
      type: "FeatureCollection" as const,
      features: parts.flatMap((d) => d!.features),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, parts);
  return { geo, failed: results.some((r) => r.isError) };
};
