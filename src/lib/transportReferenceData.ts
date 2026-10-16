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
// the mode-split footnote names. ДП ТСВ last awarded in 2019; its corporatised
// successor ТСВ ЕАД (205677435) awards nothing and is declared below as an in-group
// CONTRACTOR (TRANSPORT_INGROUP_CONTRACTORS), never as a member.
//
// ⚠ ROADS INFRASTRUCTURE IS A SEPARATE SECTOR. АПИ (000695089, ~€8.9bn) is a BUYER in
// the dedicated `roads` sector (/sector/roads); „Автомагистрали" ЕАД (831646048) is
// roads' state in-house CONTRACTOR (€983M from АПИ, ~€1M as a buyer) — declared there
// beside the buyer lists, never inside them. Both are DELIBERATELY EXCLUDED here — the
// transport dashboard keeps only a minimal roads cross-link, never folds АПИ's
// road-building billions (which would drown the rail/port/safety story and
// double-count the roads sector). Road *regulation* and
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
  | "aviation" // Въздух — БУЛАТСА (ДП РВД) + летищата София и Пловдив + ГД „Гражданска въздухоплавателна администрация"
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
  // „Летище Пловдив“ ЕАД — 100% state airport operator, same class as Летище София
  // (D2, docs/plans/transport-hub-v1.md). Small (€1.06M, 11 contracts 2011–2026, all
  // fuel CPV 09*), but it meets the inclusion rule; seat Крумово (обл. Пловдив).
  { eik: "115007069", name: "„Летище Пловдив“ ЕАД", universe: "aviation" }, // prettier-ignore
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

// ── The other three declared lists (sector-dashboard §1) ──────────────────────────
// None of these is ever in TRANSPORT_SECTOR_EIKS: the headline is an AWARDER-side Σ
// over the roll-up above, and these three answer different questions.

/** VERIFY — a body whose principal is genuinely unsettled. Shown on
 *  /sector/transport/bodies, never summed. Do not settle one by its NAME. */
export const TRANSPORT_VERIFY: { eik: string; name: string; why: string }[] = [
  {
    eik: "202623635",
    name: "„Дунав мост Видин – Калафат“ АД",
    // D3 (2026-10-16): TR holds no owner rows for an АД, and the public record
    // describes a joint BG–RO operating structure for the bridge, so neither МТС nor
    // МРРБ can be shown to be its principal from what we hold. €11.7M / 53 contracts.
    // Only the REASON: /sector/transport/bodies prints it inside „Принципалът на
    // тази структура не е потвърден (…)", so restating that clause here printed it
    // twice (T9 F10).
    why: "смесена българо-румънска структура",
  },
];

/** IN-GROUP CONTRACTORS — state companies under the transport minister that WIN
 *  contracts from the roll-up but award none themselves. They widen the intra-group
 *  flow (KPI 4 on the hub) and never touch the headline (the roads in-house shape). */
export const TRANSPORT_INGROUP_CONTRACTORS: { eik: string; name: string }[] = [
  // D4: ТСВ ЕАД is ДП ТСВ's corporatised successor (ДП ТСВ last awarded in 2019). It
  // has 0 awarder rows and wins €106.2M from НКЖИ, ДППИ and БДЖ-ПП.
  { eik: "205677435", name: "„Транспортно строителство и възстановяване“ ЕАД" },
];

/** PUBLIC CONTRACTORS OUTSIDE THE SECTOR — public bodies (state or municipal) that win
 *  money from the group but are NOT transport bodies under D1. Disclosed beside the
 *  in-group figure, never added to it (D9 default, 2026-10-16: adding Пощи would change
 *  KPI 4's basis on a body the universe rule excludes). EIKs verified against
 *  contracts.contractor_eik, 2026-10-16. */
export const TRANSPORT_PUBLIC_CONTRACTORS: {
  eik: string;
  name: string;
  principal: "state" | "municipal";
}[] = [
  { eik: "121396123", name: "„Български пощи“ ЕАД", principal: "state" }, // МТС-owned; НКЖИ meal vouchers
  { eik: "000649348", name: "„Национална електрическа компания“ ЕАД", principal: "state" }, // prettier-ignore
  { eik: "000670919", name: "НАИМ при БАН", principal: "state" }, // archaeological rescue (statutory)
  {
    eik: "129009105",
    name: "Държавен авиационен оператор",
    principal: "state",
  },
  {
    eik: "831641791",
    name: "„Информационно обслужване“ АД",
    principal: "state",
  },
  { eik: "202218735", name: "„Център за градска мобилност“ ЕАД", principal: "municipal" }, // prettier-ignore
  // transport-hub-v1 audit 2026-10-17 (T10): the МТС HQ's heat and gas suppliers.
  // EIKs taken from contracts.contractor_eik (€805,973 and €359,479).
  { eik: "831609046", name: "„Топлофикация София“ ЕАД", principal: "municipal" }, // prettier-ignore
  { eik: "175203485", name: "„Булгаргаз“ ЕАД", principal: "state" },
];

/** EU-FUNDED PROJECTS OUTSIDE THE SECTOR — fund_projects rows held by a transport
 *  body whose subject is not the movement of people or goods (D1). Excluded from
 *  every transport EU-funds figure (the hub blob, /money#funds, the AI tool) by
 *  contract number, and named in the caption. transport-hub-v1 audit 2026-10-17. */
export const TRANSPORT_EU_FUNDS_EXCLUDED: {
  contractNumber: string;
  eik: string;
  label: { bg: string; en: string };
  why: string;
}[] = [
  {
    // МТС's RRP broadband project, €240,251,787 grant, nothing paid by 2026-10:
    // the „съобщения" half of the ministry, outside the sector under D1.
    contractNumber: "BG-RRP-7.001-0001",
    eik: TRANSPORT_EIK,
    label: {
      bg: "проекта за цифрова инфраструктура (съобщения)",
      en: "the digital-infrastructure project (communications)",
    },
    why: "широколентова инфраструктура — „съобщения“, извън сектора (D1)",
  },
];

/** EU-funded projects that PASS THROUGH a transport body to others — kept in the
 *  figure (the body is the beneficiary of record) and captioned where they rank.
 *  transport-hub-v1 audit 2026-10-17. */
export const TRANSPORT_EU_FUNDS_PASS_THROUGH: {
  contractNumber: string;
  eik: string;
  label: { bg: string; en: string };
}[] = [
  {
    // ОПИК 2.079, €13.3M: aid the ministry passed on to bus operators (COVID).
    contractNumber: "BG16RFOP002-2.079-0002",
    eik: TRANSPORT_EIK,
    label: {
      bg: "помощ, предоставена на автобусни превозвачи",
      en: "aid passed on to bus operators",
    },
  },
];

/** The HHI / top-suppliers tiles' `memberEiks`: the roll-up PLUS the in-group
 *  contractors, so a payment to ТСВ ЕАД reads „в групата" (D4). Pair it with
 *  `stateBodyEiks = TRANSPORT_PUBLIC_CONTRACTOR_EIKS`, which those tiles label as an
 *  outside state body — never pass the in-group list there. */
export const TRANSPORT_GROUP_EIKS: string[] = [
  ...TRANSPORT_SECTOR_EIKS,
  ...TRANSPORT_INGROUP_CONTRACTORS.map((e) => e.eik),
];

/** The tiles' `stateBodyEiks` — public bodies outside the group (D9). */
export const TRANSPORT_PUBLIC_CONTRACTOR_EIKS: string[] =
  TRANSPORT_PUBLIC_CONTRACTORS.map((e) => e.eik);

// ── The ONE caption builder for the two lists above (review 2026-10-17, DUP-004) ──
// The hub tile, /money#funds, the AI tool and the prerendered /money body all
// name the exclusions through these, so a second entry reaches every surface and
// the verb agrees with the count („който е" / „които са").
const joinLabels = (
  xs: { label: { bg: string; en: string } }[],
  lang: "bg" | "en",
): string => xs.map((x) => x.label[lang]).join(lang === "bg" ? " и " : " and ");

/** „без проекта за цифрова инфраструктура (съобщения)" — the short form. */
export const euFundsExcludedShort = (lang: "bg" | "en"): string =>
  TRANSPORT_EU_FUNDS_EXCLUDED.length
    ? `${lang === "bg" ? "без" : "without"} ${joinLabels(TRANSPORT_EU_FUNDS_EXCLUDED, lang)}`
    : "";

/** The full sentence; `applied` false is a function deployed before ?exclude=,
 *  whose figure still includes the projects. */
export const euFundsExcludedCaption = (
  lang: "bg" | "en",
  applied: boolean,
): string => {
  const n = TRANSPORT_EU_FUNDS_EXCLUDED.length;
  if (!n) return "";
  const labels = joinLabels(TRANSPORT_EU_FUNDS_EXCLUDED, lang);
  const one = n === 1;
  if (lang === "bg")
    return applied
      ? `Без ${labels} — ${one ? "той е" : "те са"} извън сектора.`
      : `Сумата все още включва ${labels}, ${one ? "който е" : "които са"} извън сектора.`;
  return applied
    ? `Without ${labels} — ${one ? "it is" : "they are"} outside the sector.`
    : `The figure still includes ${labels}, ${one ? "which is" : "which are"} outside the sector.`;
};

/** The pass-through projects, as one sentence. */
export const euFundsPassThroughCaption = (lang: "bg" | "en"): string =>
  TRANSPORT_EU_FUNDS_PASS_THROUGH.length
    ? lang === "bg"
      ? `Сумата включва и ${joinLabels(TRANSPORT_EU_FUNDS_PASS_THROUGH, "bg")} — тези средства не остават в сектора.`
      : `The figure also includes ${joinLabels(TRANSPORT_EU_FUNDS_PASS_THROUGH, "en")} — money that does not stay in the sector.`
    : "";
