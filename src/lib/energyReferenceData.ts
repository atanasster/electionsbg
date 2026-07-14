// Енергетика (energy / БЕХ) reference data — the hand-curated EIK universe for
// the energy sector pack, mirroring src/lib/defenseReferenceData.ts and
// vikReferenceData.ts (a TS constant, not a generated crosswalk): the multi-
// entity / alias-merge concerns are the same as the defense and water sets.
// See docs/plans/energy-view-v1.md §1 (Entities — the frozen EIK allowlist).
//
// EIKs resolved from the LIVE procurement corpus (contracts.awarder_eik /
// awarder_name, 2026-07-12) — the state energy operators that actually award ЗОП
// contracts, ranked by €. The name below is a canonical Bulgarian label; the
// corpus carries spelling variants per EIK (e.g. `Електроенергиен системен
// оператор /Есо/ ЕАД` vs `ЕСО ЕАД`), all folded to one operator here by EIK.
//
// Per-EIK spend at resolution (contracts, Σ amount_eur):
//   175203478 Булгартрансгаз          980 c   €2.68bn   gas transmission
//   175201304 ЕСО (+ branch 1752013040) 4 564 c €2.59bn grid transmission
//   106513772 АЕЦ Козлодуй          3 740 c   €1.71bn   nuclear
//   123531939 ТЕЦ Марица изток 2    1 857 c   €0.74bn   lignite thermal
//   833017552 Мини Марица-изток       802 c   €0.50bn   lignite mining
//   000649348 НЕК                   1 926 c   €0.33bn   hydro + public trader
//   175203485 Булгаргаз                80 c   €6.7M     gas public supply
//   106588180 ВЕЦ Козлодуй             10 c   €0.8M     small hydro
//   831373560 БЕХ (holding parent)      0 c   —         pure holding, no ЗОП
//   176789460 Министерство на енергетиката 127 c €4.8M  policy owner / principal
// BEH core group (generation+grid+gas, excl. ministry/heat), on the serving basis
// tag='contract' (amendments excluded — the awarder_group_model / sector_stats
// basis, see [[reference_procurement_eur_sum_basis]]): 19 727 c, €8.96bn, 35.5%
// single-bid (3 339 of 9 400 bid-known). Still bigger than the МО group. (The
// per-EIK € above are an all-tags probe and run ~9% higher because amendments
// double-count; the group KPI shown in the UI uses the tag='contract' basis.)
//
// ⚠ CURATED BY EIK ALLOWLIST, NEVER BY NAME REGEX. A name sweep on "козлодуй" /
// "ядрен" false-positives the town of Козлодуй and everything in it — Община
// Козлодуй (000193250, €78M), ПГ по ядрена енергетика „Курчатов" (000185872),
// МБАЛ „Св. Иван Рилски" Козлодуй (106510388), the Козлодуй district court /
// prosecutor, a kindergarten, and the Институт за ядрени изследвания (000665231).
// A sweep on "топлофикация" pulls in PRIVATE heat utilities (ЕВН Пловдив
// 115016602, Веолия/Далкия Варна 103195446). All explicitly OUT of the state set.
//
// ⚠ THREE OWNERSHIP UNIVERSES MUST NEVER BE CONFLATED (cf. the water pack's
// holding-vs-regulated-vs-concession split): (1) the БЕХ commercial holding
// [state, principal = Министерство на енергетиката]; (2) district heating —
// mostly state (МЕ-owned) but Топлофикация София is MUNICIPAL and ЕВН/Веолия are
// PRIVATE; (3) the regulators (КЕВР, АЯР) — not commercial buyers. `ownership`
// below is a first cut inferred from name/scale; verify МЕ-vs-municipal heat
// ownership against the Търговски регистър children of 176789460 / the relevant
// община before anything reads it as a hard fact.

export const BEH_EIK = "831373560"; // Български енергиен холдинг ЕАД (parent)
export const ENERGY_MINISTRY_EIK = "176789460"; // Министерство на енергетиката
/** The group anchor the sector pack keys on (getSectorPack). БЕХ folds every
 *  subsidiary in ENERGY_SECTOR_EIKS; a landing on any single subsidiary EIK
 *  shows the generic awarder page (mirrors МО, where only MOD_EIK triggers the
 *  pack). */
export const ENERGY_GROUP_EIK = BEH_EIK;
/** The МЕ node in the per-ministry budget tree (data/budget/ministries/<id>.json,
 *  written by update-budget) — the real ministry budget behind the budget bridge.
 *  ⚠ VERIFY the slug against the emitted tree before wiring the bridge tile. */
export const ENERGY_BUDGET_NODE = "admin-ministerstvo-na-energetikata";

/** The energy "universes" — every group tile labels which slice it covers, so a
 *  whole-group fold never reads as (say) nuclear when it is mostly gas pipe. */
export type EnergyUniverse =
  | "holding" // БЕХ ЕАД (централа)
  | "nuclear" // ядрена генерация — АЕЦ Козлодуй
  | "coal" // въглищна генерация + добив — Марица изток комплекс
  | "hydro" // водна генерация + публичен търговец — НЕК
  | "grid" // пренос на ток — ЕСО
  | "gas" // газ — пренос (Булгартрансгаз) + доставка (Булгаргаз)
  | "ministry" // Министерство на енергетиката (принципал)
  | "regulator"; // КЕВР / АЯР

export type EnergyOwnership = "state" | "municipal" | "private";

export interface EnergyEntity {
  eik: string;
  /** Canonical Bulgarian label (corpus carries spelling variants per EIK). */
  name: string;
  universe: EnergyUniverse;
  ownership: EnergyOwnership;
}

// One row per distinct EIK. The БЕХ state generation/grid/gas group + principal.
export const ENERGY_ENTITIES: EnergyEntity[] = [
  { eik: BEH_EIK, name: "Български енергиен холдинг ЕАД", universe: "holding", ownership: "state" }, // prettier-ignore

  // Ядрена генерация
  { eik: "106513772", name: "АЕЦ Козлодуй ЕАД", universe: "nuclear", ownership: "state" }, // prettier-ignore

  // Въглищен комплекс „Марица изток" — генерация + добив
  { eik: "123531939", name: "ТЕЦ Марица изток 2 ЕАД", universe: "coal", ownership: "state" }, // prettier-ignore
  { eik: "833017552", name: "Мини Марица-изток ЕАД", universe: "coal", ownership: "state" }, // prettier-ignore

  // Водна генерация + публичен търговец
  { eik: "000649348", name: "Национална електрическа компания ЕАД (НЕК)", universe: "hydro", ownership: "state" }, // prettier-ignore
  { eik: "106588180", name: "ВЕЦ Козлодуй ЕАД", universe: "hydro", ownership: "state" }, // prettier-ignore

  // Пренос на електроенергия
  { eik: "175201304", name: "Електроенергиен системен оператор ЕАД (ЕСО)", universe: "grid", ownership: "state" }, // prettier-ignore

  // Газ — пренос + публична доставка
  { eik: "175203478", name: "Булгартрансгаз ЕАД", universe: "gas", ownership: "state" }, // prettier-ignore
  { eik: "175203485", name: "Булгаргаз ЕАД", universe: "gas", ownership: "state" }, // prettier-ignore

  // Принципал (не е част от БЕХ, но е държавният собственик на енергетиката)
  { eik: ENERGY_MINISTRY_EIK, name: "Министерство на енергетиката", universe: "ministry", ownership: "state" }, // prettier-ignore
];

/** The ЕСО network-region management branch (a 13-digit branch code) that folds
 *  into ЕСО proper. Kept explicit so the group query can UNION it in without a
 *  second row polluting the operator list. See the oblast-code-shard-mismatch
 *  memory for the same 13-digit-branch pattern elsewhere in the corpus. */
export const ESO_BRANCH_EIKS: string[] = ["1752013040"];

// District heating — a SEPARATE sector from the БЕХ holding. Ownership is mixed
// and MUST be verified per entity (see the header note). The state-owned
// топлофикации sit under the Ministry of Energy; Топлофикация София is municipal;
// ЕВН/Веолия are private and are NOT part of any state group. Not included in
// ENERGY_SECTOR_EIKS by default — surface as its own optional band.
export const DISTRICT_HEATING: EnergyEntity[] = [
  { eik: "831609046", name: "Топлофикация София ЕАД", universe: "grid", ownership: "municipal" }, // prettier-ignore
  { eik: "117005106", name: "Топлофикация Русе АД", universe: "grid", ownership: "state" }, // prettier-ignore
  { eik: "102011085", name: "Топлофикация Бургас АД", universe: "grid", ownership: "state" }, // prettier-ignore
  { eik: "114005624", name: "Топлофикация Плевен АД", universe: "grid", ownership: "state" }, // prettier-ignore
  { eik: "119004654", name: "Топлофикация Сливен ЕАД", universe: "grid", ownership: "state" }, // prettier-ignore
  { eik: "106006256", name: "Топлофикация Враца ЕАД", universe: "grid", ownership: "state" }, // prettier-ignore
  { eik: "113012360", name: "Топлофикация Перник АД", universe: "grid", ownership: "state" }, // prettier-ignore
  { eik: "104003977", name: "Топлофикация ВТ АД (Велико Търново)", universe: "grid", ownership: "state" }, // prettier-ignore
  { eik: "107009273", name: "Топлофикация Габрово ЕАД", universe: "grid", ownership: "state" }, // prettier-ignore
  { eik: "116019472", name: "Топлофикация Разград АД", universe: "grid", ownership: "state" }, // prettier-ignore
];

// Regulators & agencies — state energy bodies that are NOT commercial buyers;
// surface as context / cross-links, never folded into the БЕХ group procurement
// total. EIKs measured from the corpus (2026-07-12).
export const ENERGY_REGULATORS: EnergyEntity[] = [
  { eik: "000697567", name: "Агенция за ядрено регулиране (АЯР)", universe: "regulator", ownership: "state" }, // prettier-ignore
  { eik: "130098909", name: "Комисия за енергийно и водно регулиране (КЕВР)", universe: "regulator", ownership: "state" }, // prettier-ignore
  { eik: "121459246", name: "Агенция за устойчиво енергийно развитие (АУЕР)", universe: "regulator", ownership: "state" }, // prettier-ignore
];

// Joint ventures — state-LINKED but NOT wholly owned, so NOT folded into the БЕХ
// group total (mixing half-private money into a state rollup is exactly the trap
// the water pack avoids with the Sofia concession). Surface as a labelled
// cross-link / its own row.
export const ENERGY_JOINT_VENTURES: EnergyEntity[] = [
  // ICGB AD — Gas Interconnector Greece–Bulgaria (IGB): 50% БЕХ (via Булгартрансгаз)
  // / 50% IGI Poseidon. Awards under its OWN EIK (€13.7M / 42 c, 2026-07-12), NOT
  // inside Булгартрансгаз. ⚠ Contrast: Чирен storage + Балкански поток transit
  // capex DO run inside Булгартрансгаз (175203478) — €367.3M / 189 contracts whose
  // title carries чирен|балкан|транзит|компресор (verified 2026-07-12), so there
  // is no separate storage/pipeline awarder to add.
  { eik: "201383265", name: "Ай Си Джи Би АД (ICGB — газов интерконектор Гърция–България)", universe: "gas", ownership: "state" }, // prettier-ignore
];

// ⚠ INVISIBLE IN THE CORPUS — do NOT expect these in the group model:
//   • АЕЦ Козлодуй – Нови мощности ЕАД (EIK 202671079) — the AP1000 units 7/8
//     new-build, a ~€14bn program, has NO ЗОП contracts in the corpus (early
//     stage / bespoke procedures). The single biggest energy capex in the
//     country is not visible via procurement — a headline caveat for the pack,
//     never a data gap to "fix" by name-matching.
//   • БНЕБ/IBEX (energy exchange, БЕХ subsidiary) — no material ЗОП footprint.
// Private and explicitly OUT of every state rollup: Овергаз мрежи (130533432,
// €185M gas distribution), the three electricity ЕРП distributors.

const ENTITY_BY_EIK: Record<string, EnergyEntity> = Object.fromEntries(
  ENERGY_ENTITIES.map((e) => [e.eik, e]),
);

export const entityByEik = (eik: string): EnergyEntity | undefined =>
  ENTITY_BY_EIK[eik];

export const universeOf = (eik: string): EnergyUniverse | undefined =>
  ENTITY_BY_EIK[eik]?.universe;

/** БЕХ + the subsidiaries (parent first, ministry excluded). The pack fans out
 *  over this set on the holding's page; any other EIK stands alone. */
export const ENERGY_ALIAS_EIKS: string[] = ENERGY_ENTITIES.filter(
  (e) => e.eik !== BEH_EIK && e.eik !== ENERGY_MINISTRY_EIK,
).map((e) => e.eik);

/** Every state-energy EIK folded by the group model — the input to the
 *  SECTOR_BROWSE_PACKS `energy` entry and the group-rollup endpoint. Includes the
 *  ЕСО branch code so the €2.59bn grid line is complete; excludes the ministry
 *  (a policy buyer, not generation) and district heating (a separate sector). */
export const ENERGY_SECTOR_EIKS: string[] = [
  ...ENERGY_ENTITIES.filter((e) => e.universe !== "ministry").map((e) => e.eik),
  ...ESO_BRANCH_EIKS,
];

/** The БЕХ group members rolled up by the /sector/energy dashboard, in the SAME
 *  order as SECTOR_DASHBOARDS.energy `members` — so the dashboard's group-model
 *  fetch and the signature ThematicTiles' fetch share ONE react-query key
 *  (keyed on eiks.join(",")). Excludes the ЕСО branch (~€64K, immaterial) and the
 *  ministry/regulators (not part of the БЕХ commercial group). */
export const ENERGY_MEMBER_EIKS: string[] = [
  BEH_EIK,
  "106513772", // АЕЦ Козлодуй
  "123531939", // ТЕЦ Марица изток 2
  "833017552", // Мини Марица-изток
  "000649348", // НЕК
  "106588180", // ВЕЦ Козлодуй
  "175201304", // ЕСО
  "175203478", // Булгартрансгаз
  "175203485", // Булгаргаз
];

export const ENERGY_UNIVERSE_LABEL: Record<
  EnergyUniverse,
  { bg: string; en: string }
> = {
  holding: { bg: "Холдинг", en: "Holding" },
  nuclear: { bg: "Ядрена енергия", en: "Nuclear" },
  coal: { bg: "Въглища", en: "Coal" },
  hydro: { bg: "ВЕЦ и търговия", en: "Hydro & trading" },
  grid: { bg: "Електропренос", en: "Power grid" },
  gas: { bg: "Природен газ", en: "Natural gas" },
  ministry: { bg: "Министерство", en: "Ministry" },
  regulator: { bg: "Регулатор", en: "Regulator" },
};
