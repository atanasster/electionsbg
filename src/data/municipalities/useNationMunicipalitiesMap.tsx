import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { MunicipalityGeoJSON } from "@/screens/components/maps/mapTypes";

// Per-oblast muni geometry files under /maps/regions/<oblast>.json.
// Hand-listed (rather than derived) so we don't accidentally include
// admin synthetics like `32.json` (continents — Океания, Европа, ...).
// `PDV-00` is included because Plovdiv-city is split out as its own МИР.
const OBLAST_CODES = [
  "BGS",
  "BLG",
  "DOB",
  "GAB",
  "HKV",
  "JAM",
  "KNL",
  "KRZ",
  "LOV",
  "MON",
  "PAZ",
  "PDV",
  "PDV-00",
  "PER",
  "PVN",
  "RAZ",
  "RSE",
  "S23",
  "S24",
  "S25",
  "SFO",
  "SHU",
  "SLS",
  "SLV",
  "SML",
  "SZR",
  "TGV",
  "VAR",
  "VID",
  "VRC",
  "VTR",
];

const fetchAll = async (): Promise<MunicipalityGeoJSON> => {
  const fetched = await Promise.all(
    OBLAST_CODES.map(async (code) => {
      const res = await fetch(dataUrl(`/maps/regions/${code}.json`));
      if (!res.ok) return null;
      return (await res.json()) as MunicipalityGeoJSON;
    }),
  );
  const merged: MunicipalityGeoJSON = {
    type: "FeatureCollection",
    features: [],
  };
  for (const fc of fetched) {
    if (!fc) continue;
    merged.features.push(...fc.features);
  }
  return merged;
};

/** Country-wide municipality geometry — 31 oblast files merged. ~250 KB
 * raw; cached aggressively by React Query (no refetch on focus). */
export const useNationMunicipalitiesMap = () => {
  const { data } = useQuery({
    queryKey: ["nation_municipalities_map"],
    queryFn: fetchAll,
  });
  return data;
};
