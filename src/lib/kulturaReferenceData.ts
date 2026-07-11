// Култура (culture) sector reference data — the FROZEN, principal-classified EIK
// allowlist for the culture group, kept in one place so the roster tile, the
// group roll-up and any classifier can't drift. Data only; no pack logic yet
// (see docs/plans/kultura-view-v1.md §2, rev 2.2).
//
// WHY AN EXPLICIT ALLOWLIST, NEVER A NAME REGEX: the substring `опера` matches
// `опер`+`атор`/`ации` (pulls in ЕСО, ДАТО, жандармерия); `куклен` matched
// Община Куклен (a municipality); even a word-boundary regex returned 182
// "culture" awarders, including МО military museums and БАН institutes. So every
// EIK below is hand-classified by PRINCIPAL (принципал).
//
// CORPUS AUDIT: 2026-07-10, against `contracts_list` ∪ `tenders` in local
// Postgres. Nothing re-checks this map, so it WILL drift as new culture awarders
// appear. Re-run the resolution query in the plan (§2) before relying on it.
//
// COMPLETENESS: МК administers ~103 second-level spending units (74 are ДКИ, per
// Дирекция СИХО). This is a VERIFIED SUBSET — the corpus only surfaces units that
// ran ЗОП procurements. For full roster coverage, reconcile against МК's ДКИ
// register / the State-Budget-Law second-level annex (plan §15). Not a blocker:
// the НФЦ film register is keyed by producer NAME, not institute EIK, so Phase-1
// film tiles need only Tier A; this allowlist gates Phase 2 (group roll-up) and
// the awarder roster (tile 6).

/** Who a culture entity answers to — its budget principal. Only `mk` entities
 *  belong in the culture group roll-up; the rest are documented so they can't be
 *  re-added by a future name-match. */
export type CulturePrincipal =
  | "mk" // Министерство на културата
  | "mo" // Министерство на отбраната (military museums)
  | "ban_mon" // БАН / higher-ed under МОН
  | "obshtina" // municipal
  | "chitalishte"; // народно читалище — independent, municipal-delegated

// ----------------------------------------------------- Tier A · funders ------

/** Министерство на културата — the group principal and the /awarder/:eik anchor
 *  that carries the culture sector pack. 268 contracts, ~€57.2M (thin & lumpy). */
export const KULTURA_EIK = "000695160";

/** ИА „Национален филмов център" (НФЦ) — RESOLVED 2026-07-10 (finansi.bg; an
 *  administration under the Minister of Culture, founded 1991). It has ZERO
 *  procurement footprint (0 awarder / tender / contractor): it is the FILM
 *  SUBSIDY PAYER, a labelled roster entity, never a roll-up contributor. */
export const NFC_EIK = "000695833";

/** Национален фонд „Култура" (НФК) — grant payer; tiny procurement (~€0.49M). */
export const NCF_EIK = "130418031";

/** Tier A — the three funders/agencies. Bulstat entities (регистър БУЛСТАТ), NOT
 *  Commerce-Registry — so they are correctly absent from `tr_companies`; do not
 *  "verify" them there. */
export const CULTURE_FUNDER_EIKS = [KULTURA_EIK, NFC_EIK, NCF_EIK] as const;

// -------------------------------------- Tier B · state institutes (МК) -------

/** State cultural institutes with principal = Minister of Culture, VERIFIED in
 *  the corpus as state ДКИ. A verified subset of МК's ~74 ДКИ (see COMPLETENESS
 *  above). Each links to its own `/awarder/<eik>` on the roster tile. */
export const STATE_CULTURE_INSTITUTES: readonly { eik: string; bg: string }[] =
  [
    { eik: "201570119", bg: "Национален дворец на културата (НДК)" },
    { eik: "000670748", bg: "Народен театър „Иван Вазов“" },
    { eik: "000670805", bg: "Софийска опера и балет" },
    { eik: "000670794", bg: "Държавен сатиричен театър „Алеко Константинов“" },
    { eik: "000670787", bg: "Младежки театър „Николай Бинев“" },
    { eik: "000670883", bg: "Софийска филхармония" },
    { eik: "000670890", bg: "Държавен фолклорен ансамбъл „Филип Кутев“" },
    { eik: "117103220", bg: "Държавна опера — Русе" },
    { eik: "115314988", bg: "Държавна опера — Пловдив" },
    { eik: "102241054", bg: "Държавна опера — Бургас" },
    { eik: "000405995", bg: "Плевенска филхармония" },
    { eik: "000083665", bg: "Държавен куклен театър — Варна" },
    { eik: "176812208", bg: "Национална галерия" },
    { eik: "000673210", bg: "Национален исторически музей" },
    {
      eik: "000670984",
      bg: "Национален музей на българското изобразително изкуство",
    },
    { eik: "000675880", bg: "Национален музей „Земята и хората“" },
    { eik: "000672293", bg: "Национална библиотека „Св. св. Кирил и Методий“" },
    { eik: "124609886", bg: "ДКИ Културен център „Двореца“ (Балчик)" },
    { eik: "175932425", bg: "Театрално-музикален продуцентски център — Варна" },
    { eik: "108505799", bg: "Театрално-музикален център — Кърджали" },
  ];

/** Just the EIKs — derived, so the group roll-up / oblast build keep working. */
export const STATE_CULTURE_INSTITUTE_EIKS: readonly string[] =
  STATE_CULTURE_INSTITUTES.map((i) => i.eik);

/** The culture group roll-up set — Tier A funders + verified Tier B institutes.
 *  This is the `awarder_eik IN (...)` list for the group roll-up and the sector
 *  browse pack; НФЦ carries no contracts but is kept for a stable, honest set. */
export const CULTURE_GROUP_EIKS: readonly string[] = [
  ...CULTURE_FUNDER_EIKS,
  ...STATE_CULTURE_INSTITUTE_EIKS,
];

// --------------------------------------------- verify-principal (pending) ----

/** Regional drama theatres + regional museums where state (МК) vs municipal is
 *  genuinely ambiguous. NOT in the roll-up until each is resolved against МК's
 *  ДКИ register (plan §2 "verify-principal", §15). Listed, not silently dropped. */
export const VERIFY_PRINCIPAL_EIKS: readonly string[] = [
  "000282756", // Драматичен театър — Ловеч
  "000867998", // Драматичен театър — Търговище
  "000124037", // Музикално-драматичен театър „К. Кисимов" — В. Търново
  "000403802", // Драматично-куклен театър „Иван Радоев" — Плевен
  "000014352", // Драматичен театър „Н. Й. Вапцаров" — Благоевград
  "176362469", // Регионален исторически музей — София
  "000083697", // Регионален исторически музей — Варна
  "126128563", // Регионален исторически музей — Хасково
  "000210397", // Архитектурно-етнографски комплекс „Етър" — Габрово
];

// ------------------------------------------------- the anti-allowlist --------

/** EXCLUDED — principal ≠ МК, or not an institute. Kept as documentation so a
 *  future name-match can't quietly re-admit them. `reason` names the principal. */
export const EXCLUDED_EIKS: Record<
  string,
  { bg: string; principal: CulturePrincipal; reason: string }
> = {
  "129009048": {
    bg: "Национален военноисторически музей",
    principal: "mo",
    reason: "МО",
  },
  "114102692": {
    bg: "Регионален военноисторически музей — Плевен",
    principal: "mo",
    reason: "МО",
  },
  "129009016": {
    bg: 'Театър „Българска армия"',
    principal: "mo",
    reason: "МО",
  },
  "000804161": {
    bg: 'Национален парк-музей „Шипка-Бузлуджа"',
    principal: "mo",
    reason: "МО",
  },
  "000670919": {
    bg: "Национален археологически институт с музей",
    principal: "ban_mon",
    reason: "БАН",
  },
  "000665612": {
    bg: "Национален природонаучен музей",
    principal: "ban_mon",
    reason: "БАН",
  },
  "175905773": {
    bg: "Институт за етнология и фолклористика с Етнографски музей",
    principal: "ban_mon",
    reason: "БАН",
  },
  "000670723": {
    bg: 'НАТФИЗ „Кръстьо Сарафов"',
    principal: "ban_mon",
    reason: "higher-ed / МОН",
  },
  "103156991": {
    bg: "Дворец на културата и спорта ЕАД (Варна)",
    principal: "obshtina",
    reason: "municipal company (confirmed in ТР)",
  },
  "180849511": {
    bg: 'ОКИ „Музейко"',
    principal: "obshtina",
    reason: "municipal (ОКИ)",
  },
  "000677194": {
    bg: 'Малък градски театър „Зад канала"',
    principal: "obshtina",
    reason: "Столична община",
  },
  "000455560": {
    bg: "Градска художествена галерия — Пловдив",
    principal: "obshtina",
    reason: "municipal (градска)",
  },
  "115631816": {
    bg: "Община Куклен",
    principal: "obshtina",
    reason: 'FALSE regex match on „куклен" — a municipality',
  },
  // Народни читалища (all „Народно читалище …") are principal `chitalishte`:
  // independent legal entities, municipal-delegated — the читалища category
  // (Phase 3, reconstructed from ДВ standards), NOT per-EIK state institutes.
};

// ------------------------------------------------------- roster (tile 6) -----

/** The bodies shown on the culture awarder roster (VSS `JudicialAwardersTile`
 *  pattern): each deep-links to `/awarder/<eik>`, `hasPack` on МК. The 20 state
 *  institutes are counted, not all listed (most have few contracts) — surface
 *  the funders + the biggest institutes; the rest roll into a "+N institutes"
 *  count, per the VSS convention. */
export const CULTURE_BODIES: {
  eik: string;
  bg: string;
  en: string;
  hasPack?: boolean;
  noteBg?: string;
  noteEn?: string;
}[] = [
  {
    eik: KULTURA_EIK,
    bg: "Министерство на културата",
    en: "Ministry of Culture",
    hasPack: true,
    noteBg: "принципал · бюджет и програми на отделна страница",
    noteEn: "principal · budget & programmes on its own page",
  },
  {
    eik: NFC_EIK,
    bg: 'ИА „Национален филмов център"',
    en: "National Film Center (executive agency)",
    noteBg: "субсидира филмовата продукция · извън ЗОП",
    noteEn: "subsidises film production · outside procurement",
  },
  {
    eik: NCF_EIK,
    bg: 'Национален фонд „Култура"',
    en: "National Culture Fund",
    noteBg: "грантове по конкурс · извън ЗОП",
    noteEn: "competitive grants · outside procurement",
  },
  {
    eik: "201570119",
    bg: "Национален дворец на културата (НДК)",
    en: "National Palace of Culture (НДК)",
  },
];

// ----------------------------------------- CPV → operating function ---------

/** What Министерство на културата buys through ЗОП, by operating function.
 *  Derived from МК's actual contract mix (local PG): construction/restoration of
 *  cultural sites leads (div 45, ~€7.4M), then the e-culture IT backbone (72/30/48),
 *  printing & media/events (79/92/22), services (transport/maintenance/…), energy. */
export type KulturaCategory =
  | "heritage"
  | "it"
  | "media"
  | "services"
  | "energy"
  | "other";

const CPV_TO_CATEGORY: Record<string, KulturaCategory> = {
  // Сгради, реставрация, паметници на културата
  "45": "heritage",
  "71": "heritage",
  "44": "heritage",
  // ИТ и системи — е-култура, лицензи, компютри и мрежи
  "72": "it",
  "48": "it",
  "30": "it",
  "32": "it",
  "31": "it",
  // Печат, издания, медии и събития
  "79": "media",
  "22": "media",
  "92": "media",
  // Услуги — транспорт, поддръжка, охрана, застраховане
  "60": "services",
  "50": "services",
  "90": "services",
  "55": "services",
  "64": "services",
  "66": "services",
  "63": "services",
  "80": "services",
  "98": "services",
  "34": "services",
  "35": "services",
  // Енергия и горива
  "09": "energy",
};

export const categoryOfCpv = (cpv: string | undefined): KulturaCategory => {
  const d = String(cpv ?? "").slice(0, 2);
  return CPV_TO_CATEGORY[d] ?? "other";
};

export const KULTURA_CATEGORY_LABEL: Record<
  KulturaCategory,
  { bg: string; en: string }
> = {
  heritage: {
    bg: "Наследство и строителство",
    en: "Heritage & construction",
  },
  it: { bg: "ИТ и системи", en: "IT & systems" },
  media: { bg: "Печат, медии и събития", en: "Printing, media & events" },
  services: { bg: "Услуги", en: "Services" },
  energy: { bg: "Енергия и горива", en: "Energy & fuel" },
  other: { bg: "Друго", en: "Other" },
};

export const categoryLabel = (c: KulturaCategory, lang: string): string =>
  lang === "bg" ? KULTURA_CATEGORY_LABEL[c].bg : KULTURA_CATEGORY_LABEL[c].en;
