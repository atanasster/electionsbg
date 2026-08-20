// Земеделие (МЗХ) reference data — the hand-curated EIK universe for the agri
// sector, mirroring src/lib/educationReferenceData.ts / socialReferenceData.ts
// (a TS constant, not a generated crosswalk).
//
// WHAT THIS SET IS. Every awarder whose budget principal is Министерството на
// земеделието и храните: the ministry, the CAP paying agency (ДФЗ), the food-safety
// arm (БАБХ + its national labs + its областни дирекции), the executive agencies,
// one state enterprise, the областни дирекции „Земеделие", and the forestry
// administration (ИА по горите + РДГ + природните паркове). 66 EIKs, ~€597.0M
// cumulative (2011-2026).
//
// ⚠ THE HUB HEADLINE IS NOT THIS MONEY, AND MUST NOT BECOME IT. `/governance/sectors`
// fronts Земеделие at `basis: 'payout'` — €1.59bn of CAP money ДФЗ pays out to
// farmers, from `agri_payloads`. This roster is the sector's PROCUREMENT, a different
// question with a different answer. Concretely: `agri` is deliberately ABSENT from
// `SECTOR_EIKS` in scripts/db/gen_procurement/sector_stats.ts, and adding it there
// would silently flip the tile from „изплатено" to „поръчки" and from €1.59bn to
// €523.7M. `sector_stats.data.test.ts` asserts the absence for that reason.
//
// ⚠ WHY IT EXISTS AT ALL. Until the 2026-08-20 audit the sector rolled up ONE EIK —
// ДФЗ's — so `/sector/agri` showed €131.1M against a tile promising €1.6bn, and on
// its DEFAULT scope (the current parliament) it showed **€2.9M over 15 contracts**
// whose largest line was a mobile-phone contract with А1. Meanwhile МЗХ itself
// (€107.6M) and БАБХ (€217.4M — the sector's largest buyer by far) were in no sector
// at all. Same shape as the transport audit (€3.7M shown for a real €348.2M) and the
// education one. See docs/plans/agri-sector-audit-v1.md.
//
// ⚠ CURATE BY EIK ALLOWLIST, NEVER BY NAME REGEX. The `%земедел%` sweep that finds
// this roster also returns, with no way to tell them apart by name:
//   * ~15 „Професионална гимназия по земеделие" — agricultural VOCATIONAL SCHOOLS,
//     which are МОН/municipal bodies and not МЗХ ones (€8M+ combined). Including one
//     is the `7-МО Основно училище` error from the defense audit, in the same shape.
//   * every Селскостопанска академия institute and Университетът по хранителни
//     технологии (→ edu), and Напоителни системи (→ water) — all correctly claimed
//     elsewhere already, so a name sweep would double-book them.
// Every row below was resolved by EIK against the procurement corpus and verified to
// be claimed by no other sector.
//
// ⚠ A SIBLING'S EXCLUSION LIST IS AN ANTI-ALLOWLIST, AND GREPPING AN EIK FINDS IT
// EITHER WAY. This file shipped its first draft excluding ИА по горите „to
// environment" because `grep 121486802 src/lib/*ReferenceData.ts` hit
// environmentReferenceData.ts — where the EIK appears in the ADJACENT-BUT-EXCLUDED
// header block DISCLAIMING it *to the agriculture universe*, and where
// `sector_stats_environment.data.test.ts` pins its absence. The whole forestry
// administration (28 EIKs, €73.3M) was therefore in no sector at all — the exact
// stranding the education audit's own header describes, reproduced inside the file
// that describes it. Verify ownership against a sector's MEMBER list, never against
// a string's presence in a sibling file; `agriReferenceData.test.ts` now does this
// for every AGRI_EXTERNAL_BODIES row, in both directions.
//
// ⚠ THE STATE FORESTRY ENTERPRISES ARE DELIBERATELY OUT, ON KIND AND NOT ON SIZE.
// The six държавни предприятия по чл. 163 ЗГ and their териториални поделения
// (държавни горски / ловни стопанства) are МЗХ bodies too, but they are COMMERCIAL
// undertakings that sell timber rather than administrative units. Whether they
// belong is a sector-boundary decision (audit Phase 3 tier 3), not a curation slip.
// See docs/plans/agri-sector-audit-v1.md §5.
//
// ⚠ NO TOTAL IS QUOTED FOR THAT FAMILY, AND THE ABSENCE IS THE POINT. Four attempts
// to delimit it BY NAME gave four different answers, each wrong in a new way:
//   `'%държавно предприятие%' AND '%дп%дп%'`  → €911.3M — sweeps in ДП „Пристанищна
//      инфраструктура" (transport), ДП РВД, ДП „Радиоактивни отпадъци" (energy) and
//      Българския спортен тотализатор.
//   `'%държавно горско стопанство%'` alone     → €146.1M — undercounts: a parent ДП
//      and its ТП share a Булстат and file rows under both names.
//   the same folded to EIKs                     → €622.8M — pulls in Лесотехнически
//      университет's whole €23.5M (it files rows as „Учебно-опитно горско
//      стопанство") plus six ПГ по горско стопанство, one of them literally named
//      „Професионална гимназия по земеделие и горско стопанство". The university is
//      a member of educationReferenceData.ts, so that figure double-books another
//      sector's roster.
//   adding `териториално поделение`             → €992.2M — the phrase is generic;
//      ДП „Пристанищна инфраструктура" uses it too.
// TWO of those four reached committed files (this header and the plan) before the
// step-4 gate measured them. So the exclusion is stated as a KIND and the gate
// asserts MEMBERSHIP — „is any of the 66 known roster EIKs a forestry enterprise",
// a question over a closed set — rather than a magnitude nothing here can pin down.
// This file's own first rule applies to its own prose: curate, and measure, by EIK.

/** ДФ „Земеделие“ — the CAP paying agency and the group lead. Re-exported rather
 *  than restated: the digits have one home, in src/data/agri/constants.ts beside the
 *  payer identity that `/company` and the ingest read. */
export { AGRI_PAYER_EIK as AGRI_LEAD_EIK } from "@/data/agri/constants";
import { AGRI_PAYER_EIK } from "@/data/agri/constants";

/** The two ПРБ nodes in the per-ministry budget tree (data/budget/ministries/<id>.json).
 *
 *  ⚠ THREE DIFFERENT QUESTIONS LIVE UNDER THE WORD „БЮДЖЕТ" HERE, and none of them is
 *  the hub tile's number. The tile is CAP money PAID OUT to farmers (EU funds passing
 *  through ДФЗ, `basis: 'payout'`); `AGRI_PAYER_BUDGET_NODE` is the state-budget line
 *  for the paying agency; `AGRI_MINISTRY_BUDGET_NODE` is the state-budget line for the
 *  ministry. No two of the three may be added, and none is a share of another.
 *
 *  ⚠ THE PAYER NODE'S PROGRAMMES DO NOT SUM TO ITS EXPENDITURE — €18.99M of programme
 *  lines against a €300.92M total (2026), because the bulk of ДФЗ's state-budget line
 *  is money it DISBURSES rather than money it spends on itself, and this source does
 *  not itemise that. So a programme breakdown may be rendered for the MINISTRY node
 *  (whose four programmes sum exactly) and must NOT be rendered for this one. */
export const AGRI_PAYER_BUDGET_NODE = "admin-darzhaven-fond-zemedelie";

/** ⚠ The ministry RENAMED, and the older node („Министерство на земеделието",
 *  2022-2024) is a SEPARATE file. This one carries 2023 onward, so it is the right
 *  node for a current figure and the wrong one for a long trend — do not plot a
 *  series off it without folding the predecessor in first. */
export const AGRI_MINISTRY_BUDGET_NODE =
  "admin-ministerstvo-na-zemedelieto-i-hranite";

/** The nine agri "universes" — label every group tile with which it covers. */
export type AgriUniverse =
  | "ministry" // МЗХ (централа)
  | "paying_agency" // ДФ „Земеделие“ — the CAP payer
  | "food_safety" // БАБХ, its national labs and its predecessor body
  | "agency" // изпълнителни агенции и национални служби към МЗХ
  | "state_enterprise" // държавни предприятия по чл. 62, ал. 3 ТЗ към МЗХ
  | "forestry" // ИА по горите + РДГ (МЗХ — вж. ⚠ за anti-allowlist в заглавието)
  | "nature_park" // дирекции на ПРИРОДНИ паркове (към ИАГ; националните са МОСВ)
  | "regional_odbh" // областни дирекции по безопасност на храните (към БАБХ)
  | "regional_odz"; // областни дирекции „Земеделие“ (към МЗХ)

export interface AgriEntity {
  eik: string;
  /** Canonical Bulgarian label (the corpus carries spelling variants per EIK). */
  name: string;
  universe: AgriUniverse;
  /** This body no longer exists independently — its functions were absorbed by the
   *  named successor. The row is kept because its contracts are genuinely this
   *  sector's history and dropping them under-reports it, which is the exact
   *  "missing sibling" failure this roster was created to fix. */
  succeededBy?: string;
}

// One row per distinct EIK, lead first. See the header for what is deliberately out.
export const AGRI_ENTITIES: AgriEntity[] = [
  { eik: AGRI_PAYER_EIK, name: "Държавен фонд „Земеделие“ (ДФЗ)", universe: "paying_agency" }, // prettier-ignore

  // ---- Министерството ------------------------------------------------------
  // Old name in the corpus: „Министерство на земеделието и продоволствието“ (МЗП).
  // Same EIK throughout, so no retired-EIK row is needed.
  { eik: "831909905", name: "Министерство на земеделието и храните (МЗХ)", universe: "ministry" }, // prettier-ignore

  // ---- Безопасност на храните ----------------------------------------------
  // БАБХ is the sector's largest buyer — bigger than the ministry and the paying
  // agency combined. See the shared-Булстат ⚠ in the header before touching it.
  { eik: "176040023", name: "Българска агенция по безопасност на храните (БАБХ)", universe: "food_safety" }, // prettier-ignore
  { eik: "176986785", name: "Национален диагностичен научноизследователски ветеринарномедицински институт (НДНИВМИ)", universe: "food_safety" }, // prettier-ignore
  { eik: "176986461", name: "Централна лаборатория по ветеринарно-санитарна експертиза и екология (ЦЛВСЕЕ)", universe: "food_safety" }, // prettier-ignore
  { eik: "000698562", name: "Национална служба за растителна защита (НСРЗ)", universe: "food_safety", succeededBy: "176040023" }, // prettier-ignore

  // ---- Изпълнителни агенции и национални служби ------------------------------
  { eik: "000649519", name: "Изпълнителна агенция по рибарство и аквакултури (ИАРА)", universe: "agency" }, // prettier-ignore
  { eik: "130339616", name: "Национална служба за съвети в земеделието (НССЗ)", universe: "agency" }, // prettier-ignore
  { eik: "130925885", name: "Изпълнителна агенция по селекция и репродукция в животновъдството (ИАСРЖ)", universe: "agency" }, // prettier-ignore
  { eik: "121710037", name: "Контролно-техническа инспекция (КТИ)", universe: "agency" }, // prettier-ignore
  { eik: "130209583", name: "Изпълнителна агенция по сортоизпитване, апробация и семеконтрол (ИАСАС)", universe: "agency" }, // prettier-ignore
  { eik: "130297067", name: "Изпълнителна агенция по лозата и виното (ИАЛВ)", universe: "agency" }, // prettier-ignore
  { eik: "177057545", name: "Изпълнителна агенция „Сертификационен одит на средствата от европейските земеделски фондове“", universe: "agency" }, // prettier-ignore

  // ---- Държавни предприятия --------------------------------------------------
  { eik: "127512595", name: "Държавно предприятие „Кабиюк“ — Шумен", universe: "state_enterprise" }, // prettier-ignore

  // ---- Горска администрация (ИАГ + РДГ) --------------------------------------
  // МЗХ, not МОСВ — environmentReferenceData.ts's ADJACENT-BUT-EXCLUDED block says so
  // in its own words, and its data test pins ИАГ out of ENV_ENTITIES. See the
  // anti-allowlist ⚠ in the header for how this nearly went the other way.
  // Old name in the corpus for ИАГ: „Държавна агенция по горите“ (ДАГ), same EIK.
  { eik: "121486802", name: "Изпълнителна агенция по горите (ИАГ)", universe: "forestry" }, // prettier-ignore
  { eik: "108001450", name: "РДГ — Кърджали", universe: "forestry" }, // prettier-ignore
  { eik: "000626239", name: "РДГ — София", universe: "forestry" }, // prettier-ignore
  { eik: "000777262", name: "РДГ — Берковица", universe: "forestry" }, // prettier-ignore
  { eik: "000291997", name: "РДГ — Ловеч", universe: "forestry" }, // prettier-ignore
  { eik: "000138396", name: "РДГ — Велико Търново", universe: "forestry" }, // prettier-ignore
  { eik: "000029297", name: "РДГ — Благоевград", universe: "forestry" }, // prettier-ignore
  { eik: "000057880", name: "РДГ — Бургас", universe: "forestry" }, // prettier-ignore
  { eik: "000261961", name: "РДГ — Кюстендил", universe: "forestry" }, // prettier-ignore
  { eik: "000356256", name: "РДГ — Пазарджик", universe: "forestry" }, // prettier-ignore
  { eik: "000591101", name: "РДГ — Сливен", universe: "forestry" }, // prettier-ignore
  { eik: "000818620", name: "РДГ — Стара Загора", universe: "forestry" }, // prettier-ignore
  { eik: "000071129", name: "РДГ — Варна", universe: "forestry" }, // prettier-ignore
  { eik: "000472385", name: "РДГ — Пловдив", universe: "forestry" }, // prettier-ignore
  { eik: "827179902", name: "РДГ — Русе", universe: "forestry" }, // prettier-ignore
  { eik: "000615424", name: "РДГ — Смолян", universe: "forestry" }, // prettier-ignore
  { eik: "000932193", name: "РДГ — Шумен", universe: "forestry" }, // prettier-ignore

  // ---- Дирекции на природни паркове (към ИАГ) --------------------------------
  // ⚠ A ПРИРОДЕН park is МЗХ; a НАЦИОНАЛЕН park (Рила, Пирин, Централен Балкан) is
  // МОСВ. The names read alike and only these eleven belong here — the sharpest trap
  // in the environment set, enumerated there in full for the same reason.
  { eik: "130044740", name: "Дирекция на Природен парк „Витоша“", universe: "nature_park" }, // prettier-ignore
  { eik: "107554738", name: "Дирекция на Природен парк „Българка“", universe: "nature_park" }, // prettier-ignore
  { eik: "121017961", name: "Дирекция на Природен парк „Шуменско плато“", universe: "nature_park" }, // prettier-ignore
  { eik: "117085508", name: "Дирекция на Природен парк „Русенски Лом“", universe: "nature_park" }, // prettier-ignore
  { eik: "102664798", name: "Дирекция на Природен парк „Странджа“", universe: "nature_park" }, // prettier-ignore
  { eik: "114546416", name: "Дирекция на Природен парк „Персина“", universe: "nature_park" }, // prettier-ignore
  { eik: "119607289", name: "Дирекция на Природен парк „Сините камъни“", universe: "nature_park" }, // prettier-ignore
  { eik: "175544209", name: "Дирекция на Природен парк „Беласица“", universe: "nature_park" }, // prettier-ignore
  { eik: "121148188", name: "Дирекция на Природен парк „Врачански Балкан“", universe: "nature_park" }, // prettier-ignore
  { eik: "121148195", name: "Дирекция на Природен парк „Златни пясъци“", universe: "nature_park" }, // prettier-ignore
  { eik: "109514872", name: "Дирекция на Природен парк „Рилски манастир“", universe: "nature_park" }, // prettier-ignore

  // ---- Областни дирекции по безопасност на храните (към БАБХ) ----------------
  // Only the ОДБХ that appear as awarders in the corpus with their OWN EIK. The rest
  // of the 28 file under the parent Булстат — see the header.
  { eik: "176986760", name: "ОДБХ — София град", universe: "regional_odbh" }, // prettier-ignore
  { eik: "176986657", name: "ОДБХ — Хасково", universe: "regional_odbh" }, // prettier-ignore
  { eik: "176986664", name: "ОДБХ — Русе", universe: "regional_odbh" }, // prettier-ignore
  { eik: "176987022", name: "ОДБХ — Велико Търново", universe: "regional_odbh" }, // prettier-ignore
  { eik: "176986568", name: "ОДБХ — Силистра", universe: "regional_odbh" }, // prettier-ignore
  { eik: "176987111", name: "ОДБХ — Ямбол", universe: "regional_odbh" }, // prettier-ignore
  { eik: "176986949", name: "ОДБХ — Пазарджик", universe: "regional_odbh" }, // prettier-ignore
  { eik: "176986600", name: "ОДБХ — Бургас", universe: "regional_odbh" }, // prettier-ignore
  { eik: "176986803", name: "ОДБХ — Благоевград", universe: "regional_odbh" }, // prettier-ignore
  { eik: "176986109", name: "ОДБХ — Варна", universe: "regional_odbh" }, // prettier-ignore
  { eik: "176986618", name: "ОДБХ — Пловдив", universe: "regional_odbh" }, // prettier-ignore
  { eik: "176987034", name: "ОДБХ — Видин", universe: "regional_odbh" }, // prettier-ignore
  { eik: "176987175", name: "ОДБХ — Смолян", universe: "regional_odbh" }, // prettier-ignore
  { eik: "176986739", name: "ОДБХ — Сливен", universe: "regional_odbh" }, // prettier-ignore
  { eik: "176987264", name: "ОДБХ — Враца", universe: "regional_odbh" }, // prettier-ignore
  { eik: "176986689", name: "ОДБХ — Кюстендил", universe: "regional_odbh" }, // prettier-ignore

  // ---- Областни дирекции „Земеделие“ (към МЗХ) -------------------------------
  { eik: "175810250", name: "ОД „Земеделие“ — Силистра", universe: "regional_odz" }, // prettier-ignore
  { eik: "175812447", name: "ОД „Земеделие“ — София област", universe: "regional_odz" }, // prettier-ignore
  { eik: "175811879", name: "ОД „Земеделие“ — Стара Загора", universe: "regional_odz" }, // prettier-ignore
  { eik: "175818051", name: "ОД „Земеделие“ — Пловдив", universe: "regional_odz" }, // prettier-ignore
  { eik: "175811434", name: "ОД „Земеделие“ — София град", universe: "regional_odz" }, // prettier-ignore
  { eik: "175808349", name: "ОД „Земеделие“ — Разград", universe: "regional_odz" }, // prettier-ignore
  { eik: "175811402", name: "ОД „Земеделие“ — Варна", universe: "regional_odz" }, // prettier-ignore
  { eik: "175809860", name: "ОД „Земеделие“ — Бургас", universe: "regional_odz" }, // prettier-ignore
];

/** The sectors that own an agriculture-adjacent body this roster deliberately omits.
 *  Constrained to a union for the same reason EDU_UNIVERSE_RANK is a Record: a typo
 *  or a stale id must be a compile error, not a footnote naming a sector that no
 *  longer exists. */
export type AgriExternalSectorId = "water" | "edu";

/** Bodies a reader would reasonably expect in „Земеделие“ that sit in another
 *  sector, because their budget principal or their subject matter is another one.
 *  The machine-readable form of the third ⚠ in the header: the awarders-tile
 *  footnote is built from it, so the page can say the roster is not everything
 *  agricultural instead of silently implying it is, and
 *  `sector_stats.data.test.ts` asserts BOTH halves — that every EIK here is absent
 *  from AGRI_ENTITIES (the re-leakage tripwire) AND that it is really claimed by the
 *  named sector's own list. The second half is the one that matters: without it,
 *  „excluded because sector X owns it“ is an unchecked claim, which is how six
 *  institutions were nearly stranded in no sector at all in the education audit. */
export const AGRI_EXTERNAL_BODIES: ReadonlyArray<{
  eik: string;
  name: string;
  /** The sector whose allowlist owns it — verified, not assumed. */
  sector: AgriExternalSectorId;
}> = [
  { eik: "831160078", name: "Напоителни системи ЕАД", sector: "water" }, // prettier-ignore
  { eik: "000662107", name: "Селскостопанска академия (ССА)", sector: "edu" }, // prettier-ignore
  { eik: "000455440", name: "Университет по хранителни технологии — Пловдив", sector: "edu" }, // prettier-ignore
];

/** Distinct LIVE bodies in the roster — EIK count minus the succeeded ones.
 *
 *  ⚠ THIS COUNTS INSTITUTIONS, AND THE NOUN BESIDE IT MUST SAY SO. `AGRI_SECTOR_EIKS
 *  .length` counts AWARDER RECORDS, which is what the corpus groups by and what every
 *  procurement figure fans out over; the two differ by the succeeded-body rows (НСРЗ
 *  still holds a contract under its own EIK). Putting them in a ratio printed
 *  „Възложители 66 … от 65 в сектора" live on /sector/agri, and calling both
 *  „възложителя" printed 66 in one paragraph and 65 in another on the same page. So:
 *  „възложител/awarder" always means an EIK, „институция/institution" always means a
 *  body, and neither noun is used for the other count. The education audit records
 *  the same distinction („34 държавни висши училища" for 33). */
export const AGRI_BODY_COUNT = AGRI_ENTITIES.filter(
  (e) => !e.succeededBy,
).length;

/** The awarders-tile footnote — the one place the page states what its € covers and
 *  what it does not. DERIVED rather than hand-written, so the counts and the names
 *  cannot drift from the roster the way RegionalPack's did (its bg line said 28 and
 *  its en line 27 for the same set). Three claims, each established by the data
 *  above: the roster is one budget principal; the hub tile's € is CAP payout and is
 *  a DIFFERENT basis that must not be added to this one; and some agriculture-
 *  adjacent bodies sit in other sectors.
 *
 *  ⚠ No count is written in this docstring either — AGRI_EXTERNAL_BODIES owns that
 *  number, and a comment saying "four" is the same drift one layer up. */
export const agriFootnote = (bg: boolean): string => {
  const n = AGRI_BODY_COUNT;
  const inUniverse = (u: AgriUniverse) =>
    AGRI_ENTITIES.filter((e) => e.universe === u && !e.succeededBy).length;
  const odbh = inUniverse("regional_odbh");
  const odz = inUniverse("regional_odz");
  const parks = inUniverse("nature_park");
  // Count AND names from ONE array. Hard-coding „Четири“/"Four" beside a derived
  // list is exactly the RegionalPack drift this function exists to avoid: a fifth
  // external body would ship a footnote saying four and listing five, all gates green.
  const ext = AGRI_EXTERNAL_BODIES;
  const names = ext.map((e) => e.name);
  const last = names.length > 1 ? names[names.length - 1] : "";
  // A trailing „и“/"and" rather than a bare comma join: this is a sentence a reader
  // finishes, not a CSV.
  const others =
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} ${bg ? "и" : "and"} ${last}`
      : (names[0] ?? "");
  return bg
    ? `${n} институции под един бюджетен принципал — МЗХ: министерството, ДФ „Земеделие“, БАБХ с лабораториите си, изпълнителните агенции, ДП „Кабиюк“, горската администрация (ИАГ, РДГ и ${parks} дирекции на природни паркове), ${odbh} областни дирекции по безопасност на храните и ${odz} областни дирекции „Земеделие“. Числото на плочката „Земеделие“ в /governance/sectors е ИЗПЛАТЕНОТО по САР на земеделските стопани — друга основа, която не се събира със сумата на поръчките тук. Държавните горски и ловни стопанства (ТП към шестте ДП по чл. 163 ЗГ) не са включени — те са търговски предприятия, не администрация. Още ${ext.length} свързани със земеделието възложителя са в друг сектор: ${others}.`
    : `${n} institutions under a single budget principal — the agriculture ministry: the ministry itself, the CAP paying agency, the food-safety agency with its labs, the executive agencies, the „Кабиюк“ state enterprise, the forestry administration (ИАГ, the regional directorates and ${parks} nature-park directorates), ${odbh} regional food-safety directorates and ${odz} regional agriculture directorates. The „Земеделие“ figure on /governance/sectors is CAP money PAID OUT to farmers — a different basis, which must not be added to the procurement total here. The state forestry and hunting enterprises (territorial units of the six чл. 163 ЗГ enterprises) are excluded — they are commercial undertakings, not administration. A further ${ext.length} agriculture-related awarders sit in another sector: ${others}.`;
};

const ENTITY_BY_EIK: Record<string, AgriEntity> = Object.fromEntries(
  AGRI_ENTITIES.map((e) => [e.eik, e]),
);

export const agriEntityByEik = (eik: string): AgriEntity | undefined =>
  ENTITY_BY_EIK[eik];

export const agriUniverseOf = (eik: string): AgriUniverse | undefined =>
  ENTITY_BY_EIK[eik]?.universe;

/** Every agri-group EIK — the input to the sector-dashboard rollup, the
 *  SECTOR_BROWSE_PACKS `agri` entry and the awarder-group-model endpoint. */
export const AGRI_SECTOR_EIKS: string[] = AGRI_ENTITIES.map((e) => e.eik);

export const AGRI_UNIVERSE_LABEL: Record<
  AgriUniverse,
  { bg: string; en: string }
> = {
  ministry: { bg: "Министерство", en: "Ministry" },
  paying_agency: { bg: "Разплащателна агенция", en: "Paying agency" },
  food_safety: { bg: "Безопасност на храните", en: "Food safety" },
  agency: { bg: "Агенции и служби", en: "Agencies & services" },
  state_enterprise: { bg: "Държавни предприятия", en: "State enterprises" },
  forestry: { bg: "Гори (ИАГ и РДГ)", en: "Forestry (ИАГ and regional directorates)" }, // prettier-ignore
  nature_park: { bg: "Природни паркове", en: "Nature parks" },
  regional_odbh: { bg: "Областни дирекции (БАБХ)", en: "Regional directorates (food safety)" }, // prettier-ignore
  regional_odz: { bg: "Областни дирекции „Земеделие“", en: "Regional directorates (agriculture)" }, // prettier-ignore
};

export const agriUniverseLabel = (u: AgriUniverse, lang: string): string =>
  (lang === "bg" ? AGRI_UNIVERSE_LABEL[u]?.bg : AGRI_UNIVERSE_LABEL[u]?.en) ??
  u;

/** Display rank per universe: the paying agency first (it is the sector lead and
 *  what the hub tile names), then the ministry, then broadly by corpus weight.
 *  Measured 2026-08-20 — БАБХ family €221.8M, ДФЗ €131.1M, МЗХ €107.6M, forestry
 *  €58.0M, agencies €27.7M, ДП „Кабиюк“ €17.7M, ОДБХ €17.1M, природни паркове
 *  €15.2M, ОДЗ €0.4M.
 *
 *  A `Record<AgriUniverse, …>` rather than a bare ordered array ON PURPOSE: the
 *  array form compiles fine with a member missing, so a new universe would
 *  type-check everywhere and simply never appear in a picker — its units silently
 *  unreachable through the segmentation. Keyed like this, omitting one is a compile
 *  error, the same way AGRI_UNIVERSE_LABEL already forces a label. */
const AGRI_UNIVERSE_RANK: Record<AgriUniverse, number> = {
  paying_agency: 0,
  ministry: 1,
  food_safety: 2,
  forestry: 3,
  agency: 4,
  state_enterprise: 5,
  regional_odbh: 6,
  nature_park: 7,
  regional_odz: 8,
};

/** The universes present in the roster, in display order. */
export const AGRI_UNIVERSES: AgriUniverse[] = (
  Object.keys(AGRI_UNIVERSE_RANK) as AgriUniverse[]
)
  .filter((u) => AGRI_ENTITIES.some((e) => e.universe === u))
  .sort((a, b) => AGRI_UNIVERSE_RANK[a] - AGRI_UNIVERSE_RANK[b]);
