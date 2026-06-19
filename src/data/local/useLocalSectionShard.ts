// Resolves the per-município section shard for a given cycle.
//
// Sofia районs (S2***) now have their OWN per-район light-index shard
// (data/<cycle>/sections/S2***.json — ~46 stations, ~50KB) emitted by the
// pipeline, so they fetch it directly rather than pulling the full ~2MB SOF
// index and narrowing it client-side. (The heavy per-station detail files stay
// shared under sections/SOF/ — the detail hook maps S2*** → SOF.)
//
// Пловдив/Варна районs still have no per-район shard, so they load the parent
// city bundle once and narrow to the район by the section code's digits 5-6.

import { useMemo } from "react";
import { useLocalSections } from "./useLocalSections";
import { findCityRayon } from "./cityRayonCatalog";
import type { LocalSectionShard } from "./types";

export const useLocalSectionShard = (
  cycle: string,
  obshtinaCode: string,
): { shard: LocalSectionShard | undefined; hasCoords: boolean } => {
  const isSofiaRayon = /^S2\d{3}$/.test(obshtinaCode);
  const cityRayon = findCityRayon(obshtinaCode);
  // Sofia район → its own shard (no narrowing). Пловдив/Варна район → parent
  // city bundle narrowed by район код. Everything else → its own shard.
  const sectionBundle = isSofiaRayon
    ? obshtinaCode
    : (cityRayon?.obshtina ?? obshtinaCode);
  const rayonDigit = isSofiaRayon ? null : (cityRayon?.code ?? null);
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
