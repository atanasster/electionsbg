// Canonical catalog of the административни районите for the two общини с районно
// деление that the core pipeline does NOT split into separate municipalities
// (Пловдив-град = PDV22, Варна-град = VAR06). Sofia's 24 районите are real
// municipalities (S2xxx) and need no catalog — they flow through the standard
// obshtina paths; these two cities' районите exist only as a derived layer
// (scripts/helpers/gen_city_rayon_data.ts → /<election>/rayon/<muni>.json keyed
// by the 2-digit код, + /maps/city_rayons/<muni>.json polygons keyed nuts4
// "PDV22-01"), so the frontend needs this small lookup to treat a район as a
// first-class place: resolve its id, name it, link it, and find its parent.
//
// The code↔name mapping mirrors the NAMES table in gen_city_rayon_data.ts and
// is verified against ЦИК's section-code digits 5-6 (see that file's header).
// `id` is the polygon's nuts4 ("<muni>-<code>") and doubles as the route id
// (/governance/PDV22-01) and the районен-кмет name-join key (local districts[]
// are keyed by name, which matches labelBg).

import { SOFIA_RAYONS } from "@/data/budget/sofiaRayons";

export interface CityRayon {
  id: string; // "PDV22-01" — nuts4 + route id (the My-Area anchor id)
  code: string; // "01" — section-code digits 5-6
  obshtina: string; // "PDV22" — the parent city município
  cityBg: string;
  cityEn: string;
  mir: string; // multi-member constituency number ("16" / "03")
  labelBg: string;
  labelEn: string;
}

const make = (
  obshtina: string,
  cityBg: string,
  cityEn: string,
  mir: string,
  rows: [code: string, bg: string, en: string][],
): CityRayon[] =>
  rows.map(([code, labelBg, labelEn]) => ({
    id: `${obshtina}-${code}`,
    code,
    obshtina,
    cityBg,
    cityEn,
    mir,
    labelBg,
    labelEn,
  }));

export const PLOVDIV_RAYONS: CityRayon[] = make(
  "PDV22",
  "Пловдив",
  "Plovdiv",
  "16",
  [
    ["01", "Централен", "Tsentralen"],
    ["02", "Източен", "Iztochen"],
    ["03", "Западен", "Zapaden"],
    ["04", "Северен", "Severen"],
    ["05", "Южен", "Yuzhen"],
    ["06", "Тракия", "Trakiya"],
  ],
);

export const VARNA_RAYONS: CityRayon[] = make("VAR06", "Варна", "Varna", "03", [
  ["01", "Одесос", "Odesos"],
  ["02", "Приморски", "Primorski"],
  ["03", "Младост", "Mladost"],
  ["04", "Владислав Варненчик", "Vladislav Varnenchik"],
  ["05", "Аспарухово", "Asparuhovo"],
]);

export const CITY_RAYONS: CityRayon[] = [...PLOVDIV_RAYONS, ...VARNA_RAYONS];

const BY_ID = new Map(CITY_RAYONS.map((r) => [r.id, r]));

// Match a район place id: "PDV22-01" / "VAR06-05". The hyphen + obshtina
// prefix is what distinguishes it from a plain obshtina ("PDV22") or a
// settlement EKATTE in the area resolver.
export const isCityRayonId = (id?: string | null): boolean =>
  !!id && BY_ID.has(id);

export const findCityRayon = (id?: string | null): CityRayon | undefined =>
  id ? BY_ID.get(id) : undefined;

// районите of one city município (PDV22 → its 6, VAR06 → its 5), in код order.
export const cityRayonsOf = (obshtina?: string | null): CityRayon[] =>
  CITY_RAYONS.filter((r) => r.obshtina === obshtina);

// Resolve a local-elections district (districtName, e.g. "Тракия") to its
// catalog район within a given city. The local bundle's districtCode is empty,
// so the join is by normalized name — labelBg matches the district name (both
// use the official ЗТДСГГ spelling).
const norm = (s: string): string =>
  s
    .toLocaleLowerCase("bg")
    .normalize("NFC")
    .replace(/^район\s+/, "")
    .trim();
export const findCityRayonByName = (
  obshtina: string,
  districtName: string,
): CityRayon | undefined =>
  cityRayonsOf(obshtina).find((r) => norm(r.labelBg) === norm(districtName));

// Resolve a local-elections district row (one районен кмет) to the governance
// place id of its район, so the район-mayor table can deep-link. Works for all
// three градове с районно деление: Пловдив/Варна → the catalog id ("PDV22-01");
// Sofia → the район's own município code (S2xxx), since Sofia районите are real
// municipalities. Returns undefined when the name doesn't match (then the row
// stays plain text rather than a dead link).
export const districtRayonGovernanceId = (
  obshtina: string,
  districtName: string,
): string | undefined => {
  const inCity = findCityRayonByName(obshtina, districtName);
  if (inCity) return inCity.id;
  const sofia = SOFIA_RAYONS.find(
    (r) => norm(r.labelBg) === norm(districtName),
  );
  return sofia?.obshtinaCode;
};
