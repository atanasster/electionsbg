// Регионално развитие (МРРБ) reference data — the hand-curated EIK universe for
// the regional-development sector pack, mirroring src/lib/transportReferenceData.ts
// / securityReferenceData.ts (a TS constant, not a generated crosswalk). The МРРБ
// group: the ministry (principal owner) + the cadastre agency (АГКК), the national
// building-control directorate (ДНСК), and the 27 областни администрации (regional
// governors, МРРБ-supervised — they give the per-oblast geography the choropleth
// hero needs).
//
// ⚠ ROADS (АПИ) AND WATER (ВиК) ARE SEPARATE SECTORS. Агенция „Пътна
// инфраструктура" (000695089, ~€6.33bn — ~63× the whole МРРБ group) lives in
// /sector/roads, and Български ВиК холдинг (206086428) + the operating ВиК
// utilities live in /water. Both are administratively МРРБ's children but are
// DELIBERATELY EXCLUDED here — the dashboard keeps only a cross-link strip (§4
// tile 11), never folds АПИ's road billions (which would drown the sector and
// double-count roads — the exact transport lesson).
//
// ⚠ CURATE BY EIK ALLOWLIST, NEVER BY NAME REGEX. A регионал*/развитие/геодез/
// благоустройство/вик sweep false-positives badly: РЗИ/РДПБЗН/РДГ/РИОСВ/РУО
// „Регионална дирекция …" (other ministries), Регионална дирекция за социално
// подпомагане (121015056, €124.6M, АСП/МТСП), УАСГ university (000670616,
// „…геодезия"), municipal cleaning firms („благоустройство"), and schools („…вик"
// → СУ „Виктор Юго"). See docs/plans/regional-development-view-v1.md §1.
//
// EIKs resolved + € measured from the procurement corpus (contracts.awarder_eik,
// data/procurement/derived/awarders_index.json, 2026-07-16). Canonical Bulgarian
// labels below; the corpus carries spelling variants per EIK, all folded here.

export const REGIONAL_EIK = "831661388"; // Министерство на регионалното развитие и благоустройството (МРРБ) — lead/principal
export const REGIONAL_LEAD_EIK = REGIONAL_EIK;

/** The МРРБ node in the per-ministry budget tree
 *  (data/budget/ministries/<id>.json, written by update-budget) — the authoritative
 *  ЗДБ expenditure series (2025 total ≈ €1.06bn). The sectors-hub headline is
 *  BUDGET-basis off this node (NOT procurement-basis; procurement is a thin ~€100M
 *  slice of the pass-through). ⚠ Use this canonical node, NOT the soft-hyphen stub
 *  `…-blago-ustroystvoto.json` (eik:null) that orphans the 2019 slice. */
export const REGIONAL_BUDGET_NODE =
  "admin-ministerstvo-na-regionalnoto-razvitie-i-blagoustroystvoto";

/** The four МРРБ "universes" — label every group tile with which it covers. */
export type RegionalUniverse =
  | "ministry" // Министерство на регионалното развитие и благоустройството (централа)
  | "cadastre" // Агенция по геодезия, картография и кадастър (АГКК)
  | "control" // Дирекция за национален строителен контрол (ДНСК)
  | "governors"; // 27 × Областна администрация (regional governors)

export interface RegionalEntity {
  eik: string;
  /** Canonical Bulgarian label (corpus carries spelling variants per EIK). */
  name: string;
  universe: RegionalUniverse;
  /** For the 27 governors: the canonical oblast code (featureToCanon bucket) the
   *  entity maps to — the OblastChoropleth / regional.json join key. Sofia city →
   *  SOFIA_CITY, Софийска област → SFO, Пловдив → PDV. Undefined for HQ/cadastre/control. */
  oblastCode?: string;
}

// One row per distinct EIK, parent first. АПИ (roads) and ВиК (water) are
// intentionally absent — see the header note.
export const REGIONAL_ENTITIES: RegionalEntity[] = [
  { eik: REGIONAL_EIK, name: "Министерство на регионалното развитие и благоустройството", universe: "ministry" }, // prettier-ignore

  // Кадастър и геодезия + строителен контрол (the two МРРБ agencies)
  { eik: "130362903", name: "Агенция по геодезия, картография и кадастър (АГКК)", universe: "cadastre" }, // prettier-ignore
  { eik: "130008993", name: "Дирекция за национален строителен контрол (ДНСК)", universe: "control" }, // prettier-ignore

  // 27 × Областна администрация (regional governors) — parent МРРБ, the per-oblast
  // backbone. oblastCode = the canonical featureToCanon bucket (choropleth join).
  { eik: "000093360", name: "Областна администрация — област Варна", universe: "governors", oblastCode: "VAR" }, // prettier-ignore
  { eik: "000056757", name: "Областна администрация — област Бургас", universe: "governors", oblastCode: "BGS" }, // prettier-ignore
  { eik: "120068166", name: "Областна администрация — област Смолян", universe: "governors", oblastCode: "SML" }, // prettier-ignore
  { eik: "115009166", name: "Областна администрация — област Пловдив", universe: "governors", oblastCode: "PDV" }, // prettier-ignore
  { eik: "000291335", name: "Областна администрация — област Ловеч", universe: "governors", oblastCode: "LOV" }, // prettier-ignore
  { eik: "116045521", name: "Областна администрация — област Разград", universe: "governors", oblastCode: "RAZ" }, // prettier-ignore
  { eik: "108070973", name: "Областна администрация — област Кърджали", universe: "governors", oblastCode: "KRZ" }, // prettier-ignore
  { eik: "831912591", name: "Областна администрация — област София (столица)", universe: "governors", oblastCode: "SOFIA_CITY" }, // prettier-ignore
  { eik: "105042424", name: "Областна администрация — област Видин", universe: "governors", oblastCode: "VID" }, // prettier-ignore
  { eik: "106063115", name: "Областна администрация — област Враца", universe: "governors", oblastCode: "VRC" }, // prettier-ignore
  { eik: "836147490", name: "Областна администрация — област Хасково", universe: "governors", oblastCode: "HKV" }, // prettier-ignore
  { eik: "000776057", name: "Областна администрация — Софийска област", universe: "governors", oblastCode: "SFO" }, // prettier-ignore
  { eik: "101146105", name: "Областна администрация — област Благоевград", universe: "governors", oblastCode: "BLG" }, // prettier-ignore
  { eik: "000531150", name: "Областна администрация — област Русе", universe: "governors", oblastCode: "RSE" }, // prettier-ignore
  { eik: "109069461", name: "Областна администрация — област Кюстендил", universe: "governors", oblastCode: "KNL" }, // prettier-ignore
  { eik: "107053704", name: "Областна администрация — област Габрово", universe: "governors", oblastCode: "GAB" }, // prettier-ignore
  { eik: "123138141", name: "Областна администрация — област Стара Загора", universe: "governors", oblastCode: "SZR" }, // prettier-ignore
  { eik: "128052865", name: "Областна администрация — област Ямбол", universe: "governors", oblastCode: "JAM" }, // prettier-ignore
  { eik: "104103739", name: "Областна администрация — област Велико Търново", universe: "governors", oblastCode: "VTR" }, // prettier-ignore
  { eik: "114125755", name: "Областна администрация — област Плевен", universe: "governors", oblastCode: "PVN" }, // prettier-ignore
  { eik: "000320534", name: "Областна администрация — област Монтана", universe: "governors", oblastCode: "MON" }, // prettier-ignore
  { eik: "113055670", name: "Областна администрация — област Перник", universe: "governors", oblastCode: "PER" }, // prettier-ignore
  { eik: "124125725", name: "Областна администрация — област Добрич", universe: "governors", oblastCode: "DOB" }, // prettier-ignore
  { eik: "112121473", name: "Областна администрация — област Пазарджик", universe: "governors", oblastCode: "PAZ" }, // prettier-ignore
  { eik: "118039613", name: "Областна администрация — област Силистра", universe: "governors", oblastCode: "SLS" }, // prettier-ignore
  { eik: "127070650", name: "Областна администрация — област Шумен", universe: "governors", oblastCode: "SHU" }, // prettier-ignore
  { eik: "119101402", name: "Областна администрация — област Сливен", universe: "governors", oblastCode: "SLV" }, // prettier-ignore
];

const ENTITY_BY_EIK: Record<string, RegionalEntity> = Object.fromEntries(
  REGIONAL_ENTITIES.map((e) => [e.eik, e]),
);

export const regionalEntityByEik = (eik: string): RegionalEntity | undefined =>
  ENTITY_BY_EIK[eik];

export const regionalUniverseOf = (eik: string): RegionalUniverse | undefined =>
  ENTITY_BY_EIK[eik]?.universe;

/** The canonical oblast code for a governor EIK (choropleth join), or undefined. */
export const regionalOblastOf = (eik: string): string | undefined =>
  ENTITY_BY_EIK[eik]?.oblastCode;

/** МРРБ proper + the subordinate agencies/administrations (parent first). The pack
 *  fans out over this set on the ministry's page; any other EIK stands alone. */
export const REGIONAL_ALIAS_EIKS: string[] = REGIONAL_ENTITIES.filter(
  (e) => e.eik !== REGIONAL_EIK,
).map((e) => e.eik);

/** Every МРРБ-group EIK — the input to the sector-dashboard rollup, the
 *  SECTOR_BROWSE_PACKS `regional` entry and the awarder-group-model endpoint. */
export const REGIONAL_SECTOR_EIKS: string[] = REGIONAL_ENTITIES.map(
  (e) => e.eik,
);

export const REGIONAL_UNIVERSE_LABEL: Record<
  RegionalUniverse,
  { bg: string; en: string }
> = {
  ministry: { bg: "Министерство (централа)", en: "Ministry (HQ)" },
  cadastre: { bg: "Кадастър и геодезия (АГКК)", en: "Cadastre & geodesy (АГКК)" },
  control: { bg: "Строителен контрол (ДНСК)", en: "Building control (ДНСК)" },
  governors: { bg: "Областни администрации", en: "Regional governors" },
};

export const regionalUniverseLabel = (
  u: RegionalUniverse,
  lang: string,
): string =>
  (lang === "bg"
    ? REGIONAL_UNIVERSE_LABEL[u]?.bg
    : REGIONAL_UNIVERSE_LABEL[u]?.en) ?? u;

/** Ordered universes for a Select / the category tile (ministry first, then by
 *  corpus weight: cadastre dominates, then control, then the governors). */
export const REGIONAL_UNIVERSES: RegionalUniverse[] = [
  "ministry",
  "cadastre",
  "control",
  "governors",
];

/** The regional programme codes in the ИСУН corpus (data/funds/taxonomy.json) —
 *  the МРРБ-managed cohesion OPs whose money routes to municipalities. Used by the
 *  absorption burn-down tile + the cohesion AI tool. */
export const REGIONAL_COHESION_PROGRAMS = [
  "2014BG16RFOP001", // ОПРР „Региони в растеж" 2014-20 (closed, ~96% absorbed)
  "2021BG16FFPR003", // Програма „Развитие на регионите" 2021-27 (~20% — absorption-risk)
] as const;
