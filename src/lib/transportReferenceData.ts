// Транспорт (МТС) reference data — the hand-curated EIK universe for the transport
// sector pack, mirroring src/lib/securityReferenceData.ts / defenseReferenceData.ts
// (a TS constant, not a generated crosswalk).
//
// THE INCLUSION RULE, stated once so the next audit can apply it rather than re-argue
// it: a body belongs here when its principal is the transport minister AND it serves
// the movement of people or goods — the ministry itself, the per-mode INFRASTRUCTURE
// MANAGERS (НКЖИ for rail, ДППИ for ports, ИАППД for the Danube, БУЛАТСА for air), the
// state OPERATORS (БДЖ, Летище София), the per-mode REGULATORS (ИАЖА, ИА МА, ГД ГВА,
// ИА АА) plus the road-safety agency — and, FOR RAIL ONLY, the state WORKS enterprise
// (ДП ТСВ). Four layers, every mode.
//
// ⚠ The works layer is the one asymmetry, and it has ONE reason rather than two: rail
// building is in because rail has no sector of its own, while road building is out
// because roads DO (/sector/roads) and folding it here would double-count them. It is
// not a claim that rail construction is more "transport" than road construction. Note
// ДП ТСВ is also the first member that is materially a CONTRACTOR TO the group as well
// as an awarder within it (€44.8M from НКЖИ + БДЖ), so it widens the intra-group flow
// the mode-split footnote names.
//
// ⚠ ROADS INFRASTRUCTURE IS A SEPARATE SECTOR. АПИ (000695089, ~€5.6bn) and
// „Автомагистрали" ЕАД (831646048) live in the dedicated `roads` sector (/sector/roads)
// and are DELIBERATELY EXCLUDED here — the transport dashboard keeps only a minimal
// roads cross-link, never folds АПИ's road-building billions (which would drown the
// rail/port/safety story and double-count the roads sector). Road *regulation* and
// *safety* (ИА „Автомобилна администрация", ДАБДП) DO belong to МТС's remit and are
// included; road *building* does not.
//
// EXPLICITLY OUT (anti-allowlist — each was measured and rejected in the 2026-08-13
// sector audit, docs/plans/transport-sector-audit-v1.md; do not re-add without a
// decision):
//   • Метрополитен ЕАД (000632256, €1.69bn) — MUNICIPAL (Столична община), not state;
//     belongs to the Sofia governance view.
//   • The „съобщения" half of МТС's own name — Български пощи (121396123, €236.0M) and
//     ИАЕСМИС (131516795, €20.2M). Administratively МТС's, but they need a sixth,
//     non-transport universe; /sector/transport stays about moving people and goods.
//   • State port OPERATORS — Пристанище Варна (103061301, €63.6M), Пристанищен
//     комплекс Русе (117021078, €5.5M), Пристанище Бургас (102004532, €2.0M). The
//     sector carries the port INFRASTRUCTURE company (ДППИ) and the regulator (ИА МА).
//   • Транспортните болници — НМТБ „Цар Борис III" (000662655, €10.8M) and МТБ Пловдив
//     (115214445, €11.3M). МТС-owned but they buy medicines and consumables: the
//     ВМА-in-defense distortion of "what the sector buys", for 0.3% of the sector.
//   • КРС (121747864, €38.1M) — reports to Народното събрание, not МТС; communications.
//   • Държавен авиационен оператор (129009105, €16.8M) — към Министерски съвет; already
//     on securityReferenceData.ts's anti-allowlist.
//
// EIKs resolved + € measured from the procurement corpus (contracts.awarder_eik,
// awarders_index.json; refreshed 2026-08-13). Canonical Bulgarian labels below; the
// corpus carries spelling variants per EIK, all folded to one entity here by EIK.
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
  | "maritime" // Море, пристанища и река Дунав — ДППИ + ИА „Морска администрация" + ИАППД
  | "aviation" // Въздух — БУЛАТСА (ДП РВД) + Летище София + ГД „Гражданска въздухоплавателна администрация"
  | "road"; // Автомобилен транспорт (регулация) + пътна безопасност — ИА „Автомобилна администрация" + ДАБДП

export interface TransportEntity {
  eik: string;
  /** Canonical Bulgarian label (corpus carries spelling variants per EIK). */
  name: string;
  universe: TransportUniverse;
}

// One row per distinct EIK. Roads-infrastructure (АПИ / Автомагистрали), municipal
// Метрополитен and the rest of the anti-allowlist are intentionally absent — see the
// header note.
export const TRANSPORT_ENTITIES: TransportEntity[] = [
  { eik: TRANSPORT_EIK, name: "Министерство на транспорта и съобщенията", universe: "ministry" }, // prettier-ignore

  // Железници (rail) — infrastructure manager + the БДЖ operating group + rail-safety
  // regulator + the state rail-construction enterprise
  { eik: "130823243", name: "ДП „Национална компания Железопътна инфраструктура“ (НКЖИ)", universe: "rail" }, // prettier-ignore
  { eik: "130822878", name: "Холдинг „Български държавни железници“ (БДЖ)", universe: "rail" }, // prettier-ignore
  { eik: "175405647", name: "„БДЖ — Пътнически превози“ ЕООД", universe: "rail" }, // prettier-ignore
  { eik: "175403856", name: "„БДЖ — Товарни превози“ ЕООД", universe: "rail" }, // prettier-ignore
  { eik: "130663221", name: "ИА „Железопътна администрация“ (ИАЖА)", universe: "rail" }, // prettier-ignore
  { eik: "130847116", name: "ДП „Транспортно строителство и възстановяване“ (ДП ТСВ)", universe: "rail" }, // prettier-ignore

  // Море, пристанища и река Дунав (maritime, ports & inland waterway)
  { eik: "130316140", name: "ДП „Пристанищна инфраструктура“", universe: "maritime" }, // prettier-ignore
  { eik: "121797867", name: "ИА „Морска администрация“", universe: "maritime" }, // prettier-ignore
  { eik: "000513106", name: "ИА „Проучване и поддържане на река Дунав“ (ИАППД)", universe: "maritime" }, // prettier-ignore

  // Въздух (aviation) — the air-navigation infrastructure manager, the state airport
  // company and the regulator. ⚠ БУЛАТСА is the AIR-SIDE ANALOGUE of НКЖИ (rail) and
  // ДППИ (ports): without it this universe was €3.7M against a real €348.2M, i.e. the
  // mode-split tile reported state aviation procurement 94x too small (audit 2026-08-13).
  { eik: "000697179", name: "ДП „Ръководство на въздушното движение“ (БУЛАТСА)", universe: "aviation" }, // prettier-ignore
  // ⚠ „Летище София“ ЕАД is 100% state with МТС as principal, and its corpus runs
  // 2011-01-13 → 2021-04-06 and stops there of its own accord — the SOF Connect
  // operating concession took the airport over later in 2021. No date cutoff is needed
  // or wanted: a windowed scope past 2021 simply finds nothing for this EIK.
  { eik: "121023551", name: "„Летище София“ ЕАД", universe: "aviation" }, // prettier-ignore
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
  maritime: { bg: "Море, пристанища и Дунав", en: "Maritime, ports & Danube" },
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

/** Ordered universes for a Select / the mode-split tile. FIXED, not value-sorted —
 *  the mode-split colours follow the entity, not its rank, so a corpus refresh must
 *  never repaint the bars. Ministry first, then the modes in descending corpus weight
 *  as re-measured at the 2026-08-13 audit (rail €4.14bn · aviation €348M · maritime
 *  €297M · road €53M). Re-check the order when a mode's weight moves past a
 *  neighbour's; nothing breaks if it drifts, the bars just stop reading top-to-bottom. */
export const TRANSPORT_UNIVERSES: TransportUniverse[] = [
  "ministry",
  "rail",
  "aviation",
  "maritime",
  "road",
];
