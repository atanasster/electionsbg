// Shared place-search building blocks — the SINGLE source of truth for how a
// settlement / município / Sofia район becomes a search-index row, and how the
// two My-Area autocompletes (AreaSniperButton + MyAreaEntryScreen) filter and
// label those rows. Both index hooks (useSearchItems, useAreaSearchItems) and
// both autocompletes import from here so the four consumers can't drift — the
// "d" (район) split previously had to be applied in four places by hand and one
// was missed.

import type { SearchIndexType } from "./useSearchItems";
import type { SettlementInfo, MunicipalityInfo } from "@/data/dataTypes";
import { isSofiaRayonObshtina } from "@/data/local/placeViews";
import { CITY_RAYONS } from "@/data/local/cityRayonCatalog";

// Search-index types that map to an anchorable My-Area destination: settlement
// ("s"), município ("m"), and Sofia район shard ("d"). районите anchor exactly
// like a município (goTo → /governance/S2xxx), so "d" belongs here too.
export const AREA_TYPES = new Set<SearchIndexType["type"]>(["s", "m", "d"]);

// A Sofia район's settlement copy carries a composite ("68134-2401") EKATTE.
export const isCompositeEkatte = (ekatte: string): boolean =>
  ekatte.includes("-");

// i18n key for a place type's short badge in the My-Area autocompletes.
export const areaTypeShortKey = (type: SearchIndexType["type"]): string =>
  type === "s"
    ? "settlement_short"
    : type === "d"
      ? "rayon_short"
      : "municipality_short";

// The shared place rows for both the fat (useSearchItems) and slim
// (useAreaSearchItems) indexes: every settlement + every município, with
// Sofia's 24 S2xxx shards surfaced as "d" (район) parented to Столична община
// rather than peered with real общини. 21 of the 24 районите carry a composite
// ("68134-2401") EKATTE settlement copy, dropped here so each район surfaces
// once (via the muni branch); the 3 town-centred районите (Банкя / Нови Искър /
// Панчарево) have no composite copy and re-enter solely via the muni branch.
export const buildPlaceItems = (
  settlements: SettlementInfo[],
  municipalities: MunicipalityInfo[],
  // Only the name fields are needed for parentName lookup. Typed structurally
  // (not RegionInfo[]) because the abroad МИР 32 row carries no `ekatte`, so the
  // bundled regions.json isn't assignable to the ekatte-required RegionInfo[].
  regions: readonly { oblast: string; name: string; name_en?: string }[],
): SearchIndexType[] => {
  const regionByCode = new Map(regions.map((r) => [r.oblast, r]));
  const muniByCode = new Map(municipalities.map((m) => [m.obshtina, m]));
  const items: SearchIndexType[] = settlements
    .filter((s) => !isCompositeEkatte(s.ekatte))
    .map((s) => {
      const muni = muniByCode.get(s.obshtina);
      const region = regionByCode.get(s.oblast);
      const parts = [muni?.name, region?.name].filter(Boolean);
      const partsEn = [muni?.name_en, region?.name_en].filter(Boolean);
      return {
        type: "s" as const,
        key: s.ekatte,
        name: s.name,
        name_en: s.name_en,
        parentName: parts.length ? parts.join(", ") : undefined,
        parentName_en: partsEn.length ? partsEn.join(", ") : undefined,
      };
    });
  municipalities.forEach((m) => {
    const region = regionByCode.get(m.oblast);
    const isRayon = isSofiaRayonObshtina(m.obshtina);
    items.push({
      type: isRayon ? "d" : "m",
      key: m.obshtina,
      name: m.name,
      name_en: m.name_en,
      parentName: isRayon ? "Столична община" : region?.name,
      parentName_en: isRayon
        ? "Stolichna (Sofia) municipality"
        : region?.name_en,
    });
  });
  // Пловдив/Варна районите aren't in municipalities.json (they're a derived
  // sub-city layer), so add them explicitly as "район" rows that route to the
  // район governance place. `path` is needed because their id ("PDV22-01")
  // maps to /governance/<id>, not the /settlement/<key> that the fat index's
  // "d" navigation otherwise assumes; the slim My-Area index anchors via key
  // (goTo → /governance/<key>), which lands on the same place.
  for (const r of CITY_RAYONS) {
    items.push({
      type: "d",
      key: r.id,
      name: r.labelBg,
      name_en: r.labelEn,
      parentName: `Община ${r.cityBg}`,
      parentName_en: `${r.cityEn} municipality`,
      path: `/governance/${r.id}`,
    });
  }
  return items;
};
