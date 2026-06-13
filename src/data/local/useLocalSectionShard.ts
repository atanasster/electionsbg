// Resolves the per-município section shard for a given cycle, transparently
// handling Sofia район shards (S2***): their stations live in the synthetic
// SOF bundle, tagged by район in chars 4-5 of the 9-digit section code, so the
// city bundle is loaded once (cached across all 24 районы) and narrowed here.
//
// Centralises the logic that LocalSectionsTile used to carry inline so the same
// shard can drive the council map at the top of the município page AND the
// full section table at the bottom — React Query dedupes the single fetch.

import { useMemo } from "react";
import { useLocalSections } from "./useLocalSections";
import { findCityRayon } from "./cityRayonCatalog";
import type { LocalSectionShard } from "./types";

export const useLocalSectionShard = (
  cycle: string,
  obshtinaCode: string,
): { shard: LocalSectionShard | undefined; hasCoords: boolean } => {
  const isSofiaRayon = /^S2\d{3}$/.test(obshtinaCode);
  // A Пловдив/Варна район ("VAR06-02") has no shard of its own — its stations
  // sit in the parent city bundle, tagged by район in the section code's digits
  // 5-6, exactly like the Sofia районите, only keyed off the catalog instead of
  // the S2 code. So load the parent bundle once and narrow to the район here.
  const cityRayon = findCityRayon(obshtinaCode);
  const sectionBundle = isSofiaRayon
    ? "SOF"
    : (cityRayon?.obshtina ?? obshtinaCode);
  const rayonDigit = isSofiaRayon
    ? obshtinaCode.slice(-2)
    : (cityRayon?.code ?? null);
  const { shard: rawShard } = useLocalSections(sectionBundle, cycle);
  const shard = useMemo(() => {
    if (!rawShard || !rayonDigit) return rawShard;
    return {
      ...rawShard,
      sections: rawShard.sections.filter(
        (s) => s.sectionCode.slice(4, 6) === rayonDigit,
      ),
    };
  }, [rawShard, rayonDigit]);
  const hasCoords = !!shard?.sections.some(
    (s) => typeof s.longitude === "number" && typeof s.latitude === "number",
  );
  return { shard, hasCoords };
};
