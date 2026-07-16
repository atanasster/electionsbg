// Околна среда (МОСВ) reference data — the hand-curated EIK universe for the
// environment sector pack, mirroring src/lib/transportReferenceData.ts /
// securityReferenceData.ts (a TS constant, not a generated crosswalk). The МОСВ
// system: the ministry (principal owner) + ИАОС (the air/monitoring agency) + the
// ПУДООС environment fund + the 3 national-park directorates + НИМХ (meteo) + the 4
// river-basin directorates + the 16 РИОСВ regional inspectorates.
//
// ⚠ CURATE BY EIK ALLOWLIST, NEVER BY NAME REGEX. An "околна среда" / "парк" sweep
// false-positives on the „Шипка — Бузлуджа" park-MUSEUM (000804161, a historical
// monument, NOT an МОСВ directorate) and on МЗХ forestry bodies (ИА по горите + РДГ).
// Every entity below is EIK-verified from the corpus (awarders_index.json).
//
// ⚠ FIGURES ARE NOT PINNED HERE. The corpus refreshes intra-day, so € live from the
// model at render time (like transport/security) — this file is EIK + label + universe
// only. See docs/plans/environment-view-v1.md §0.5.
//
// ⚠ ADJACENT-BUT-EXCLUDED (cross-link only, never in the rollup):
//   • Forestry (МЗХ): ИА по горите 121486802 + 16 РДГ — agriculture universe.
//   • ВиК / Напоителни — the /water view. Environment = pollution / waste / nature;
//     water = water-supply utilities. The ОП „Околна среда" водни-цикъл projects
//     belong to /water; environment claims the air / waste / nature slices.
//   • Шипка — Бузлуджа park-museum 000804161 — keyword false-positive.

export const MOSV_EIK = "000697371"; // Министерство на околната среда и водите (МОСВ) — lead/principal
export const ENV_LEAD_EIK = MOSV_EIK;
export const IAOS_EIK = "831901762"; // ИАОС — Изпълнителна агенция по околна среда (air/monitoring)
export const PUDOOS_EIK = "131045382"; // ПУДООС — Предприятие за управление на дейностите по опазване на околната среда

/** The МОСВ node in the per-ministry budget tree (data/budget/ministries/<id>.json,
 *  written by update-budget) — the ministry expenditure series that carries the three
 *  policy programs (опазване на компонентите; мониторинг/ИАОС; метеорология). */
export const MOSV_BUDGET_NODE = "admin-ministerstvo-na-okolnata-sreda-i-vodite";

/** The env EU-funds programme codes — join key for the OP absorption tile (from the
 *  static data/funds/derived/absorption.json byProgramme[], §0.5). The two ОП „Околна
 *  среда" periods carry ~99% of the money; the three EEA/Norway grants are on-thesis
 *  (MODAIRN = air quality). */
export const ENV_FUND_PROGRAM_CODES = [
  "2014BG16M1OP002", // Околна среда 2014-2020 (Cohesion Fund)
  "2021BG16FFPR002", // Програма „Околна среда" 2021-2027 (ERDF/CF)
  "BGENVIRONMENT", // ЕИП/Норвежки — опазване на околната среда и климатични промени
  "MODAIRN", // ЕИП/Норвежки — модернизирана система за качеството на въздуха
  "PEST", // ЕИП/Норвежки — остарели пестициди
] as const;

/** The seven МОСВ "universes" — label every group tile with which it covers. */
export type EnvUniverse =
  | "ministry" // Министерство на околната среда и водите (централа)
  | "agency" // ИАОС — air quality & monitoring
  | "fund" // ПУДООС — the environment fund
  | "parks" // Дирекции на националните паркове (Рила / Пирин / Централен Балкан)
  | "basin" // Басейнови дирекции (4 river-basin directorates)
  | "riosv" // Регионални инспекции по околната среда и водите (16)
  | "meteo"; // НИМХ — метеорология и хидрология

export interface EnvEntity {
  eik: string;
  /** Canonical Bulgarian label (corpus carries spelling variants per EIK). */
  name: string;
  universe: EnvUniverse;
}

// One row per distinct EIK. Forestry (МЗХ), the Шипка park-museum and ВиК/Напоителни
// are intentionally absent — see the header note.
export const ENV_ENTITIES: EnvEntity[] = [
  { eik: MOSV_EIK, name: "Министерство на околната среда и водите", universe: "ministry" }, // prettier-ignore
  { eik: IAOS_EIK, name: "Изпълнителна агенция по околна среда (ИАОС)", universe: "agency" }, // prettier-ignore
  { eik: PUDOOS_EIK, name: "ПУДООС — Предприятие за управление на дейностите по опазване на околната среда", universe: "fund" }, // prettier-ignore

  // Национални паркове (national-park directorates)
  { eik: "101157692", name: "Дирекция „Национален парк Рила“", universe: "parks" }, // prettier-ignore
  { eik: "101549540", name: "Дирекция „Национален парк Пирин“", universe: "parks" }, // prettier-ignore
  { eik: "107061359", name: "Дирекция „Национален парк Централен Балкан“", universe: "parks" }, // prettier-ignore

  // Метеорология и хидрология
  { eik: "000663814", name: "Национален институт по метеорология и хидрология (НИМХ)", universe: "meteo" }, // prettier-ignore

  // Басейнови дирекции (river-basin directorates)
  { eik: "103776654", name: "Басейнова дирекция „Черноморски район“ (Варна)", universe: "basin" }, // prettier-ignore
  { eik: "114597909", name: "Басейнова дирекция „Дунавски район“ (Плевен)", universe: "basin" }, // prettier-ignore
  { eik: "115756766", name: "Басейнова дирекция „Източнобеломорски район“ (Пловдив)", universe: "basin" }, // prettier-ignore
  { eik: "101619985", name: "Басейнова дирекция „Западнобеломорски район“ (Благоевград)", universe: "basin" }, // prettier-ignore

  // 16 × РИОСВ — регионални инспекции по околната среда и водите. 8 carry the city in
  // the name; the 8 generic „Регионална инспекция…" rows were disambiguated via
  // buyer_oblast_map.json (each distinct:1, no collision). ⚠ Those geo seats are
  // delivery-location NUTS3, not registered seat — the EIKs are pinned as literals.
  { eik: "000530415", name: "РИОСВ Русе", universe: "riosv" }, // prettier-ignore
  { eik: "000776025", name: "РИОСВ София", universe: "riosv" }, // prettier-ignore
  { eik: "000093339", name: "РИОСВ Варна", universe: "riosv" }, // prettier-ignore
  { eik: "102007021", name: "РИОСВ Бургас", universe: "riosv" }, // prettier-ignore
  { eik: "000471013", name: "РИОСВ Пловдив", universe: "riosv" }, // prettier-ignore
  { eik: "000024617", name: "РИОСВ Благоевград", universe: "riosv" }, // prettier-ignore
  { eik: "000320510", name: "РИОСВ Монтана", universe: "riosv" }, // prettier-ignore
  { eik: "000614817", name: "РИОСВ Смолян", universe: "riosv" }, // prettier-ignore
  { eik: "000817529", name: "РИОСВ Стара Загора", universe: "riosv" }, // prettier-ignore
  { eik: "000133513", name: "РИОСВ Велико Търново", universe: "riosv" }, // prettier-ignore
  { eik: "000351519", name: "РИОСВ Пазарджик", universe: "riosv" }, // prettier-ignore
  { eik: "126004380", name: "РИОСВ Хасково", universe: "riosv" }, // prettier-ignore
  { eik: "000193955", name: "РИОСВ Враца", universe: "riosv" }, // prettier-ignore
  { eik: "000414414", name: "РИОСВ Плевен", universe: "riosv" }, // prettier-ignore
  { eik: "113594988", name: "РИОСВ Перник", universe: "riosv" }, // prettier-ignore
  { eik: "000932129", name: "РИОСВ Шумен", universe: "riosv" }, // prettier-ignore
];

const ENTITY_BY_EIK: Record<string, EnvEntity> = Object.fromEntries(
  ENV_ENTITIES.map((e) => [e.eik, e]),
);

export const envEntityByEik = (eik: string): EnvEntity | undefined =>
  ENTITY_BY_EIK[eik];

export const envUniverseOf = (eik: string): EnvUniverse | undefined =>
  ENTITY_BY_EIK[eik]?.universe;

/** No alias-EIK duplicates for the core bodies today — kept for parity with the
 *  transport/security packs so callers can spread it unconditionally. */
export const ENV_ALIAS_EIKS: string[] = ENV_ENTITIES.filter(
  (e) => e.eik !== MOSV_EIK,
).map((e) => e.eik);

/** Every environment-group EIK — the input to the sector-dashboard rollup, the
 *  SECTOR_BROWSE_PACKS `environment` entry and the awarder-group-model endpoint. */
export const ENV_SECTOR_EIKS: string[] = ENV_ENTITIES.map((e) => e.eik);

export const ENV_UNIVERSE_LABEL: Record<
  EnvUniverse,
  { bg: string; en: string }
> = {
  ministry: { bg: "Министерство (централа)", en: "Ministry (HQ)" },
  agency: { bg: "ИАОС (мониторинг)", en: "ИАОС (monitoring)" },
  fund: { bg: "ПУДООС (фонд)", en: "ПУДООС (fund)" },
  parks: { bg: "Национални паркове", en: "National parks" },
  basin: { bg: "Басейнови дирекции", en: "River-basin directorates" },
  riosv: { bg: "РИОСВ (инспекции)", en: "РИОСВ (inspectorates)" },
  meteo: { bg: "Метеорология (НИМХ)", en: "Meteorology (НИМХ)" },
};

export const envUniverseLabel = (u: EnvUniverse, lang: string): string =>
  (lang === "bg" ? ENV_UNIVERSE_LABEL[u]?.bg : ENV_UNIVERSE_LABEL[u]?.en) ?? u;

/** Ordered universes for a Select / the awarders tile — ministry & the monitoring
 *  agency first (they carry the group), then fund, parks, basins, inspectorates, meteo. */
export const ENV_UNIVERSES: EnvUniverse[] = [
  "ministry",
  "agency",
  "fund",
  "parks",
  "basin",
  "riosv",
  "meteo",
];
