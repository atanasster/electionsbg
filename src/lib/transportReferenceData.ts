// Транспорт (МТС) reference data — the hand-curated EIK universe for the transport
// sector pack, mirroring src/lib/securityReferenceData.ts / defenseReferenceData.ts
// (a TS constant, not a generated crosswalk). The state transport group: the ministry
// (principal owner) + the rail companies (НКЖИ, БДЖ), the port-infrastructure company,
// the maritime/aviation/rail-transport regulators, and the road-safety agency.
//
// ⚠ ROADS INFRASTRUCTURE IS A SEPARATE SECTOR. АПИ (000695089, ~€5.6bn) and
// „Автомагистрали" ЕАД (831646048) live in the dedicated `roads` sector (/sector/roads)
// and are DELIBERATELY EXCLUDED here — the transport dashboard keeps only a minimal
// roads cross-link, never folds АПИ's road-building billions (which would drown the
// rail/port/safety story and double-count the roads sector). Road *regulation* and
// *safety* (ИА „Автомобилна администрация", ДАБДП) DO belong to МТС's remit and are
// included; road *building* does not.
//
// ⚠ Метрополитен ЕАД (000632256, ~€1.3bn) is MUNICIPAL (Столична община), not state —
// excluded; it belongs to the Sofia governance view.
//
// EIKs resolved + € measured from the procurement corpus (contracts.awarder_eik,
// awarders_index.json, 2026-07-15). Canonical Bulgarian labels below; the corpus
// carries spelling variants per EIK, all folded to one entity here by EIK.
// ⚠ CURATE BY EIK ALLOWLIST, NEVER BY NAME REGEX (a "транспорт" sweep false-positives
// on municipal transport companies, "Градски транспорт" ЕАД, school-transport lines).

export const TRANSPORT_EIK = "000695388"; // Министерство на транспорта и съобщенията (МТС) — lead/principal
export const TRANSPORT_LEAD_EIK = TRANSPORT_EIK;
/** The МТС node in the per-ministry budget tree (data/budget/ministries/<id>.json,
 *  written by update-budget) — the ministry budget series that carries the state
 *  rail subsidy / PSO. NB the state rail/port ENTERPRISES (НКЖИ, БДЖ) are commercial
 *  entities with their own budgets, NOT inside this node. */
export const TRANSPORT_BUDGET_NODE =
  "admin-ministerstvo-na-transporta-i-saobshteniyata";

/** The five transport "universes" — label every group tile with which it covers. */
export type TransportUniverse =
  | "ministry" // Министерство на транспорта и съобщенията (централа)
  | "rail" // Железници — НКЖИ (инфраструктура) + БДЖ холдинг/пътнически/товарни + ИАЖА
  | "maritime" // Море и пристанища — ДП „Пристанищна инфраструктура" + ИА „Морска администрация"
  | "aviation" // Въздух — ГД „Гражданска въздухоплавателна администрация"
  | "road"; // Автомобилен транспорт (регулация) + пътна безопасност — ИА „Автомобилна администрация" + ДАБДП

export interface TransportEntity {
  eik: string;
  /** Canonical Bulgarian label (corpus carries spelling variants per EIK). */
  name: string;
  universe: TransportUniverse;
}

// One row per distinct EIK. Roads-infrastructure (АПИ / Автомагистрали) and municipal
// Метрополитен are intentionally absent — see the header note.
export const TRANSPORT_ENTITIES: TransportEntity[] = [
  { eik: TRANSPORT_EIK, name: "Министерство на транспорта и съобщенията", universe: "ministry" }, // prettier-ignore

  // Железници (rail) — infrastructure manager + the БДЖ operating group + rail-safety regulator
  { eik: "130823243", name: "ДП „Национална компания Железопътна инфраструктура“ (НКЖИ)", universe: "rail" }, // prettier-ignore
  { eik: "130822878", name: "Холдинг „Български държавни железници“ (БДЖ)", universe: "rail" }, // prettier-ignore
  { eik: "175405647", name: "„БДЖ — Пътнически превози“ ЕООД", universe: "rail" }, // prettier-ignore
  { eik: "175403856", name: "„БДЖ — Товарни превози“ ЕООД", universe: "rail" }, // prettier-ignore
  { eik: "130663221", name: "ИА „Железопътна администрация“ (ИАЖА)", universe: "rail" }, // prettier-ignore

  // Море и пристанища (maritime & ports)
  { eik: "130316140", name: "ДП „Пристанищна инфраструктура“", universe: "maritime" }, // prettier-ignore
  { eik: "121797867", name: "ИА „Морска администрация“", universe: "maritime" }, // prettier-ignore

  // Въздух (aviation)
  { eik: "121805755", name: "ГД „Гражданска въздухоплавателна администрация“ (ГД ГВА)", universe: "aviation" }, // prettier-ignore

  // Автомобилен транспорт (regulation) + пътна безопасност (road safety) — NOT road building
  { eik: "121410441", name: "ИА „Автомобилна администрация“", universe: "road" }, // prettier-ignore
  { eik: "177344399", name: "Държавна агенция „Безопасност на движението по пътищата“ (ДАБДП)", universe: "road" }, // prettier-ignore
];

const ENTITY_BY_EIK: Record<string, TransportEntity> = Object.fromEntries(
  TRANSPORT_ENTITIES.map((e) => [e.eik, e]),
);

export const transportEntityByEik = (
  eik: string,
): TransportEntity | undefined => ENTITY_BY_EIK[eik];

export const transportUniverseOf = (
  eik: string,
): TransportUniverse | undefined => ENTITY_BY_EIK[eik]?.universe;

/** МТС proper + the subordinate companies/agencies (parent first). The pack fans out
 *  over this set on the ministry's page; any other EIK stands alone. */
export const TRANSPORT_ALIAS_EIKS: string[] = TRANSPORT_ENTITIES.filter(
  (e) => e.eik !== TRANSPORT_EIK,
).map((e) => e.eik);

/** Every transport-group EIK — the input to the sector-dashboard rollup, the
 *  SECTOR_BROWSE_PACKS `transport` entry and the awarder-group-model endpoint. */
export const TRANSPORT_SECTOR_EIKS: string[] = TRANSPORT_ENTITIES.map(
  (e) => e.eik,
);

export const TRANSPORT_UNIVERSE_LABEL: Record<
  TransportUniverse,
  { bg: string; en: string }
> = {
  ministry: { bg: "Министерство (централа)", en: "Ministry (HQ)" },
  rail: { bg: "Железници", en: "Railways" },
  maritime: { bg: "Море и пристанища", en: "Maritime & ports" },
  aviation: { bg: "Въздух", en: "Aviation" },
  road: {
    bg: "Автомобилен транспорт и безопасност",
    en: "Road transport & safety",
  },
};

export const transportUniverseLabel = (
  u: TransportUniverse,
  lang: string,
): string =>
  (lang === "bg"
    ? TRANSPORT_UNIVERSE_LABEL[u]?.bg
    : TRANSPORT_UNIVERSE_LABEL[u]?.en) ?? u;

/** Ordered universes for a Select / the mode-split tile (ministry first, then by
 *  corpus weight: rail dominates, then maritime, aviation, road). */
export const TRANSPORT_UNIVERSES: TransportUniverse[] = [
  "ministry",
  "rail",
  "maritime",
  "aviation",
  "road",
];
