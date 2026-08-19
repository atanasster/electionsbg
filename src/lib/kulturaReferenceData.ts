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
// CORPUS AUDIT: continuous since 2026-08-18. `scripts/db/tests/culture_register.data.test.ts`
// sweeps BOTH corpora (contracts by awarded €, tenders by estimated €, floor
// €200k each), subtracts the four declared lists and the читалища name rule, and
// FAILS on anything left over — so a new culture awarder now breaks a test
// instead of silently going missing. The sentence this replaces („nothing
// re-checks this map, so it WILL drift") was true for thirteen months and cost
// fifteen art schools, three state theatres and a national institute.
//
// What the gate does NOT check: whether a classification is RIGHT. It only
// requires that one exists. Principal is still a human judgement, and T3.1 (МК's
// ДКИ register) is what will make it verifiable.
//
// COMPLETENESS: МК administers ~103 second-level spending units (74 are ДКИ, per
// Дирекция СИХО). This is a VERIFIED SUBSET — the corpus only surfaces units that
// ran ЗОП procurements. For full roster coverage, reconcile against МК's ДКИ
// register / the State-Budget-Law second-level annex (plan §15). Not a blocker:
// the НФЦ film register is keyed by producer NAME, not institute EIK, so Phase-1
// film tiles need only Tier A; this allowlist gates Phase 2 (group roll-up) and
// the awarder roster (tile 6).
//
// THE FOUR LISTS, and why there are four rather than three (T0.6, 2026-08-18):
//   CULTURE_GROUP_EIKS   — the roll-up. Principal = МК. Funders + institutes +
//                          the art schools. This is what every € total means.
//   VERIFY_PRINCIPAL_EIKS — държавен-or-общински genuinely unsettled. Listed so
//                          they cannot drift; excluded from the roll-up.
//   ADJACENT_EIKS        — a REAL cultural body whose principal is not МК
//                          (higher-ed arts, БАН, МО, other ministries).
//   EXCLUDED_EIKS        — not a cultural body at all: municipal, an NGO, or a
//                          plain regex false match.
// A body belongs to exactly one, and the gate asserts it.

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

/** ИА „Национален филмов център“ (НФЦ) — RESOLVED 2026-07-10 (finansi.bg; an
 *  administration under the Minister of Culture, founded 1991). It has ZERO
 *  procurement footprint (0 awarder / tender / contractor): it is the FILM
 *  SUBSIDY PAYER, a labelled roster entity, never a roll-up contributor. */
export const NFC_EIK = "000695833";

/** Национален фонд „Култура“ (НФК) — grant payer; tiny procurement (~€0.49M). */
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
    // Added 2026-08-18 by the register gate's corpus sweep — „Държавен/Държавна"
    // or a national institute by statute (ЗКН чл. 15), i.e. the same class as the
    // entries above. All three were undeclared.
    { eik: "123089870", bg: "Държавна опера — Стара Загора" },
    { eik: "000804072", bg: "Държавен куклен театър" },
    {
      eik: "121710606",
      bg: "Национален институт за недвижимо културно наследство (НИНКН)",
    },
    // Added 2026-08-18 by the register gate's TENDERS arm — both „Държавен",
    // both invisible to a contracts-only sweep because neither has ever been
    // AWARDED a contract in the corpus, only published procedures.
    { eik: "000044566", bg: "Държавен куклен театър — Бургас" },
    { eik: "000154660", bg: "Държавен куклен театър" },
  ];

/** Just the EIKs — derived, so the group roll-up / oblast build keep working. */
export const STATE_CULTURE_INSTITUTE_EIKS: readonly string[] =
  STATE_CULTURE_INSTITUTES.map((i) => i.eik);

// ------------------------------------------- Tier B · national art schools ---

/** МК's national schools of the arts — второстепенни разпоредители с бюджет под
 *  Министерството на културата, and the tier this file was missing entirely
 *  until 2026-08-18. Seventeen of them procure; NONE was in any of the three
 *  lists, so every one was invisible to the roll-up, the roster, the oblast map
 *  and the search box at once.
 *
 *  ⚠️ THE WORST-COMPETING TIER IN THE SECTOR — 46.5% single-bid (72 of 155
 *  bid-known) against a 40.9% national baseline. (The plan carried 53.0%
 *  (71/134) for this tier; no basis in the corpus reproduces it.) That is the reason the omission mattered:
 *  the sector's most competition-poor tier was the one absent from its own
 *  dashboard. НУКК `831154303` is the largest of them and the buyer the ACF
 *  „Милиони зад кулисите“ story turns on.
 *
 *  BASIS: the naming convention is decisive for principal here — „Национално
 *  училище по изкуствата / за музикално, танцово, фолклорно, изящно изкуство"
 *  and „Национална гимназия за приложни изкуства“ are МК units, while a
 *  „Национална гимназия“ for humanities or ancient languages is МОН. The three
 *  МОН look-alikes this rule rejects are documented in EXCLUDED_EIKS so a later
 *  sweep cannot re-admit them. T3.1 (МК's ДКИ register) is what turns this from
 *  a convention into a verified list. */
export const ART_SCHOOLS: readonly { eik: string; bg: string }[] = [
  { eik: "831154303", bg: "Национален учебен комплекс по култура (НУКК)" },
  {
    eik: "000212722",
    bg: "Национална гимназия за приложни изкуства „Тревненска школа“",
  },
  {
    eik: "000403460",
    bg: "Национално училище по изкуствата „Панайот Пипков“ — Плевен",
  },
  {
    eik: "000610128",
    bg: "Национално училище за фолклорни изкуства „Широка лъка“",
  },
  { eik: "000044210", bg: "НУМСИ „Проф. Панчо Владигеров“ — Бургас" },
  {
    eik: "000522379",
    bg: "Национално училище по изкуствата „Проф. Веселин Стоянов“ — Русе",
  },
  {
    eik: "000083302",
    bg: "Национално училище по изкуствата „Добри Христов“ — Варна",
  },
  { eik: "000669799", bg: "Национално училище за танцово изкуство — София" },
  {
    eik: "000669678",
    bg: "Национална гимназия за приложни изкуства „Свети Лука“ — София",
  },
  {
    eik: "000669781",
    bg: "Национално училище за изящни изкуства „Илия Петров“ — София",
  },
  {
    eik: "000458930",
    bg: "Национална гимназия за сценични и екранни изкуства — Пловдив",
  },
  {
    eik: "000582700",
    bg: "Национално училище за фолклорни изкуства „Филип Кутев“ — Котел",
  },
  { eik: "000455029", bg: "НУМТИ „Добрин Петков“ — Пловдив" },
  { eik: "000803725", bg: "НУПИД „Акад. Дечко Узунов“ — Казанлък" },
  { eik: "000807453", bg: "НУМСИ „Христина Морфова“ — Стара Загора" },
  // „Национална художествена гимназия" — the naming variant the first sweep
  // missed (it looked for „училище по изкуствата" and „гимназия за приложни
  // изкуства"). Both МК; found by the gate's TENDERS arm.
  {
    eik: "000585002",
    bg: "Национална художествена гимназия „Димитър Добрович“ — Сливен",
  },
  {
    eik: "000458948",
    bg: "Национална художествена гимназия „Цанко Лавренов“ — Пловдив",
  },
];

export const ART_SCHOOL_EIKS: readonly string[] = ART_SCHOOLS.map((s) => s.eik);

/** The nine regional theatres МК's OWN ДКИ register lists as its state cultural
 *  institutes — the T0.2 ruling, taken 2026-08-19 on primary-source evidence.
 *
 *  They sat in `VERIFY_PRINCIPAL_EIKS` from the start because „Драматичен театър
 *  — Ловеч" does not say държавен or общински on its face, and no source we held
 *  settled it. `scripts/culture/dki/` settles it: each of the nine appears by
 *  name on mc.government.bg's own „Държавни драматични и драматично-куклени
 *  театри" / „Държавни културни институти в областта на музикалното и танцовото
 *  изкуство" pages, i.e. МК stating its own remit.
 *
 *  ⚠️ THIS MOVED THE SECTOR'S HEADLINE €. Measured at the time of the ruling:
 *  the roll-up went from 881 contracts / €157,944,723 to €165,430,428, **+4.7%**
 *  — €7,485,705 across eight of the nine, led by Константин Кисимов (€2.44m) and
 *  Ловеч (€2.37m). The ninth, Пазарджик (112582278), reached the register only
 *  through the TENDERS arm of the corpus sweep and has no awarded contract, so
 *  it contributes nothing to the money and everything to the roster. If a
 *  committed culture figure looks ~5% higher than a note written before
 *  2026-08-19, this is why.
 *
 *  ⚠️ THEY CARRY NAMES, and that is not decoration. Being in
 *  `CULTURE_GROUP_EIKS` is not the same as being REACHABLE: the roster tile, the
 *  institution finder and the awarders list all build their rows from
 *  `CULTURE_BODIES ∪ STATE_CULTURE_INSTITUTES ∪ ART_SCHOOLS ∪ this`, so a bare
 *  EIK array adds €7.5m to every total while leaving nine bodies findable only
 *  by someone who already knows the number. The art schools shipped that way
 *  once; `culture_register.data.test.ts` is what catches it.
 *
 *  The evidence lives in `data/culture/dki_register.json` and the reconciliation
 *  that produced it is `scripts/culture/dki/reconcile.ts`. */
export const DKI_CONFIRMED_INSTITUTES: readonly { eik: string; bg: string }[] =
  [
    {
      eik: "000124037",
      bg: "Музикално-драматичен театър „Константин Кисимов“ — Велико Търново",
    },
    { eik: "000282756", bg: "Драматичен театър — Ловеч" },
    { eik: "000403802", bg: "Драматично-куклен театър „Иван Радоев“ — Плевен" },
    {
      eik: "000014352",
      bg: "Драматичен театър „Н. Й. Вапцаров“ — Благоевград",
    },
    { eik: "000867998", bg: "Драматичен театър — Търговище" },
    { eik: "000455489", bg: "Драматичен театър „Н. О. Масалитинов“ — Пловдив" },
    { eik: "126004416", bg: "Драматично-куклен театър „Иван Димов“ — Хасково" },
    { eik: "000522703", bg: "Драматичен театър „Сава Огнянов“ — Русе" },
    // Reached the register through the TENDERS arm of the corpus sweep: published
    // procedures, no awarded contract. It contributes nothing to the money and
    // everything to the roster.
    {
      eik: "112582278",
      bg: "Драматично-куклен театър „Константин Величков“ — Пазарджик",
    },

    // ---- SECOND RULING, same day, on the rest of the register's evidence ----
    // These six were in NO list at all — the register's own blind-spot finding: a
    // ДКИ with little or no ЗОП procurement is invisible to a corpus sweep. МК
    // lists each on its own ДКИ pages, and NOTHING in this repo's reference data
    // makes a competing claim about any of them (checked against every
    // *ReferenceData.ts, the sector generator, the dashboards and the browse
    // packs). Same evidence class as the nine above.
    { eik: "000210326", bg: "Драматичен театър „Рачо Стоянов“ — Габрово" },
    { eik: "127508351", bg: "Драматично-куклен театър „Васил Друмев“ — Шумен" },
    {
      eik: "000608604",
      bg: "Родопски драматичен театър „Николай Хайтов“ — Смолян",
    },
    { eik: "000153836", bg: "Симфониета — Видин" },
    { eik: "000185307", bg: "Симфониета — Враца" },
    // Was EXCLUDED as `obshtina` / „Столична община". МК lists it on its own
    // „Държавни драматични и драматично-куклени театри" page — МК calling it
    // ДЪРЖАВЕН — and the exclusion's recorded justification („appears in no МК
    // ДКИ listing") is contradicted by the primary source: it is the SECOND entry
    // on that page. The municipal claim is unsourced anywhere in this repo. T0.3.
    { eik: "831381016", bg: "Театрална работилница „Сфумато“" },

    // The three art schools. Two were in no list; НГДЕК was EXCLUDED as `ban_mon`
    // with the reason „ancient languages and cultures, not an МК art school".
    // That misreads МК's own category, which is „училища по изкуствата И ПО
    // КУЛТУРАТА" — and a classics gymnasium is precisely the culture half of it.
    // МК lists all three on that page. Note the МОН schools register does NOT
    // discriminate here: every one of the 17 existing ART_SCHOOLS appears in it
    // too, so membership there is no evidence of principal either way.
    {
      eik: "000669774",
      bg: "Национално музикално училище „Любомир Пипков“ — София",
    },
    {
      eik: "000669802",
      bg: "Национална професионална гимназия по полиграфия и фотография",
    },
    { eik: "000674508", bg: "НГДЕК „Константин Кирил Философ“ — София" },
  ];

export const DKI_CONFIRMED_INSTITUTE_EIKS: readonly string[] =
  DKI_CONFIRMED_INSTITUTES.map((t) => t.eik);

/** The culture group roll-up set — Tier A funders + verified Tier B institutes.
 *  This is the `awarder_eik IN (...)` list for the group roll-up and the sector
 *  browse pack; НФЦ carries no contracts but is kept for a stable, honest set. */
export const CULTURE_GROUP_EIKS: readonly string[] = [
  ...CULTURE_FUNDER_EIKS,
  ...STATE_CULTURE_INSTITUTE_EIKS,
  ...ART_SCHOOL_EIKS,
  ...DKI_CONFIRMED_INSTITUTE_EIKS,
];

// --------------------------------------------- verify-principal (pending) ----

/** Regional drama theatres + regional museums where state (МК) vs municipal is
 *  genuinely ambiguous. NOT in the roll-up until each is resolved against МК's
 *  ДКИ register (plan §2 "verify-principal", §15). Listed, not silently dropped. */
export const VERIFY_PRINCIPAL_EIKS: readonly string[] = [
  "176362469", // Регионален исторически музей — София
  "000083697", // Регионален исторически музей — Варна
  "126128563", // Регионален исторически музей — Хасково
  "000210397", // Архитектурно-етнографски комплекс „Етър“ — Габрово
  // Added 2026-08-18 by the register gate's corpus sweep. Same class as the
  // nine above — regional museums, libraries and theatres where държавен vs
  // общински is genuinely ambiguous from the name alone — and all were
  // undeclared. Listed, not silently dropped; T3.1's ДКИ register resolves them.
  "000014384", // Регионален исторически музей — Благоевград (€1.23m)
  "000523666", // Регионална библиотека „Любен Каравелов“ — Русе
  "000343052", // Регионален исторически музей — Пазарджик
  "000252994", // Регионален исторически музей „Акад. Й. Иванов“ — Кюстендил
  "102826129", // Исторически музей — Малко Търново
  "000085463", // Регионална библиотека „П. Р. Славейков“ — Велико Търново
  "000212487", // Музей „Дом на хумора и сатирата“ — Габрово
  "000455585", // Регионален етнографски музей — Пловдив
  "000868018", // Регионален исторически музей — Търговище
  "175685416", // Регионален център на ЮНЕСКО за нематериално културно наследство
  // From the TENDERS arm of the same sweep — procedures only, no awarded
  // contract, so a contracts-only gate could never have seen them.
  "000124051", // Регионален исторически музей
  "000609948", // Регионална библиотека „Николай Вранчев“
  "000014391", // Археологически музей — Сандански
  "821103584", // Исторически музей
  "000923087", // Регионален исторически музей — Шумен
  "176218487", // Исторически музей — Севлиево
  "124700599", // Исторически музей — Каварна (€2.74m of procedures)
  "175953608", // Исторически музей — Павликени
  "114008855", // Регионален исторически музей (no city anywhere in the corpus)
  "000804108", // Регионален исторически музей (no city anywhere in the corpus)
  "000455592", // Регионален природонаучен музей — Пловдив
  "176349482", // Регионален исторически музей — Габрово
  "000455578", // Регионален археологически музей — Пловдив
  "831602703", // Профилирана гимназия по изобразителни изкуства „Проф. Н. Райнов“
  //              — „Профилирана", not „Национална": likely МОН/общинска rather
  //              than an МК art school, but the name alone does not settle it.
  "000665644", // „Централна библиотека“ — almost certainly БАН's (its EIK sits
  //              beside 000665612, the БАН natural-history museum), which would
  //              make it ADJACENT rather than verify — but „almost certainly“
  //              is not a classification, so it waits for T3.1 like the rest.
];

// ------------------------------------------------ adjacent (T0.6, decided) ---

/** CULTURE-ADJACENT — a real cultural body whose budget principal is NOT МК.
 *
 *  T0.6, decided 2026-08-18. The question was whether „the culture universe“ is
 *  *principal = МК* or *everything a reader would call culture*, and the answer
 *  is: the ROLL-UP stays principal = МК (this file's founding rule, and what
 *  keeps НАТФИЗ and НХА treated alike), and the bodies the rule turns away get
 *  their own DECLARED list instead of disappearing into the anti-allowlist.
 *
 *  Why it needed deciding at all: `EXCLUDED_EIKS` was carrying two different
 *  claims under one name — „this is not a culture body“ (Община Куклен, a regex
 *  false match) and „this is a culture body that answers to somebody else“
 *  (Националният военноисторически музей). Reading the second as the first is
 *  what made Tier D look „absent“ in the plan when it was documented all along,
 *  and it is why €28.6m of art-academy procurement had no home.
 *
 *  What this list is FOR: the register gate accepts these as classified, so they
 *  never show up as unclassified drift; the hub may surface them as a labelled
 *  band („културни институции с друг принципал“); and no roll-up, headline or
 *  €-total includes them. A reader is never told they do not exist — only that
 *  somebody else pays for them.
 *
 *  What it is NOT: a waiting room. A body moves out of here only when its
 *  principal actually changes, or when T3.1's ДКИ register proves the
 *  classification wrong. */
export type CultureAdjacentKind =
  | "higher_ed_arts" // state arts university/academy — принципал МОН
  | "ban_museum" // БАН institute that runs a museum
  | "mo_museum" // Министерство на отбраната
  | "other_ministry"; // a national museum under some other ministry

export const ADJACENT_EIKS: Record<
  string,
  { bg: string; kind: CultureAdjacentKind; reason: string }
> = {
  "000670716": {
    bg: "Национална художествена академия (НХА)",
    kind: "higher_ed_arts",
    reason:
      "държавно висше училище, принципал МОН — €22.7m, the largest single " +
      "non-МК culture buyer in the corpus",
  },
  "000670723": {
    bg: "НАТФИЗ „Кръстьо Сарафов“",
    kind: "higher_ed_arts",
    reason: "държавно висше училище, принципал МОН",
  },
  "000670552": {
    bg: "Университет по библиотекознание и информационни технологии (УниБИТ)",
    kind: "higher_ed_arts",
    reason: "държавно висше училище, принципал МОН",
  },
  "115013887": {
    bg: "Академия за музикално, танцово и изобразително изкуство (АМТИИ) — Пловдив",
    kind: "higher_ed_arts",
    reason: "държавно висше училище, принципал МОН",
  },
  "000670919": {
    bg: "Национален археологически институт с музей (НАИМ)",
    kind: "ban_museum",
    reason: "БАН",
  },
  "000665612": {
    bg: "Национален природонаучен музей",
    kind: "ban_museum",
    reason: "БАН",
  },
  "175905773": {
    bg: "Институт за етнология и фолклористика с Етнографски музей",
    kind: "ban_museum",
    reason: "БАН",
  },
  "175905638": {
    bg: "Институт по експериментална морфология, патология и антропология с музей",
    kind: "ban_museum",
    reason: "БАН — found undeclared by the register gate's sweep, €0.49m",
  },
  "129009048": {
    bg: "Национален военноисторически музей",
    kind: "mo_museum",
    reason: "МО",
  },
  "114102692": {
    bg: "Регионален военноисторически музей — Плевен",
    kind: "mo_museum",
    reason: "МО",
  },
  "129009016": {
    bg: "Театър „Българска армия“",
    kind: "mo_museum",
    reason: "МО",
  },
  "000804161": {
    bg: "Национален парк-музей „Шипка-Бузлуджа“",
    kind: "mo_museum",
    reason: "МО",
  },
  "121022030": {
    bg: "Национален земеделски музей",
    kind: "other_ministry",
    reason:
      "Министерство на земеделието — a national museum, but not an МК one. " +
      "Found by the gate's tenders arm; the fourth kind exists because the " +
      "first three (higher-ed, БАН, МО) turned out not to exhaust the class.",
  },
};

export const ADJACENT_EIK_LIST: readonly string[] = Object.keys(ADJACENT_EIKS);

// ------------------------------------------------- the anti-allowlist --------

/** EXCLUDED — NOT a state cultural institute at all: a municipal body, a
 *  differently-principaled school, or a plain regex false match. Kept as
 *  documentation so a future name-match can't quietly re-admit them.
 *
 *  ⚠️ Distinct from ADJACENT_EIKS above, and the distinction is the whole point
 *  of T0.6: this list says „not one of these“, that one says „one of these, paid
 *  for by somebody else". Putting a national museum here reads as a denial. */
export const EXCLUDED_EIKS: Record<
  string,
  { bg: string; principal: CulturePrincipal; reason: string }
> = {
  "103156991": {
    bg: "Дворец на културата и спорта ЕАД (Варна)",
    principal: "obshtina",
    reason: "municipal company (confirmed in ТР)",
  },
  "180849511": {
    bg: "ОКИ „Музейко“",
    principal: "obshtina",
    reason: "municipal (ОКИ)",
  },
  "000677194": {
    bg: "Малък градски театър „Зад канала“",
    principal: "obshtina",
    reason:
      "Столична община. T0.3 — the EVIDENCE, not just the verdict: ACF's " +
      "„Милиони зад кулисите“ calls the principal МК; the theatre is a " +
      "второстепенен разпоредител of Столична община (it is an ОКИ, like " +
      "Музейко above) and appears in no МК ДКИ listing. The two claims are " +
      "not reconciled from a primary source yet — T3.1's ДКИ register " +
      "settles it. Until then it stays municipal, which is the reading that " +
      "does NOT put a municipal theatre into a state roll-up.",
  },
  "000455560": {
    bg: "Градска художествена галерия — Пловдив",
    principal: "obshtina",
    reason: "municipal (градска)",
  },
  "176182033": {
    bg: "Общинска фондация „Пловдив 2019“",
    principal: "obshtina",
    reason:
      "общинска фондация — municipal, €0.73m, found undeclared by the " +
      "register gate's sweep",
  },
  "121003584": {
    bg: "ОКИ „Столична библиотека“",
    principal: "obshtina",
    reason: "общински културен институт — municipal, like Музейко above",
  },
  "000673477": {
    bg: "Театър „София“",
    principal: "obshtina",
    reason: "Столична община — a municipal theatre, like Зад канала",
  },
  "000133965": {
    bg: "Община Свищов",
    principal: "obshtina",
    reason:
      "a MUNICIPALITY — matched through its name variant Отдел „Образование и " +
      "култура“. A municipal department is not a cultural institute.",
  },
  "000056764": {
    bg: "Община Айтос",
    principal: "obshtina",
    reason:
      "a MUNICIPALITY — matched through its name variant Дирекция „Образование, " +
      "култура, вероизповедание, спорт и туризъм“. Same shape as Свищов above.",
  },
  "123559551": {
    bg: "Сдружение „Нашенци“ — фолклорен ансамбъл",
    principal: "obshtina",
    reason: "сдружение (NGO), not a state or municipal cultural institute",
  },
  "177130790": {
    bg: "Асоциация за култура, технологии, образование и развитие",
    principal: "obshtina",
    reason:
      "сдружение (NGO), not a state or municipal cultural institute — an " +
      "awarder only because it runs EU-funded projects",
  },
  "115631816": {
    bg: "Община Куклен",
    principal: "obshtina",
    reason: "FALSE regex match on „куклен“ — a municipality",
  },
  "121330447": {
    bg: "Българска федерация по художествена гимнастика",
    principal: "obshtina",
    reason:
      "FALSE match on „художествена“ — rhythmic GYMNASTICS, €3.2m. The " +
      "buyer-side twin of `изкуствен интелект`: the culture name matcher is " +
      "calibrated on beneficiary names and this is what it does to " +
      "awarder_name.",
  },
  "000087699": {
    bg: "Национална гимназия за хуманитарни науки и изкуства „Константин Преславски“ — Варна",
    principal: "ban_mon",
    reason:
      "МОН — a general-education gymnasium. One of the three look-alikes the " +
      "Tier B naming rule rejects: „изкуства“ in the name, not an МК art school.",
  },
  "000610929": {
    bg: "Професионална гимназия за приложни изкуства — Смолян",
    principal: "obshtina",
    reason: "„Професионална“, not „Национална“ — МОН/municipal, not МК",
  },
  // Народни читалища (all „Народно читалище …“) are principal `chitalishte`:
  // independent legal entities, municipal-delegated — see CHITALISHTE_NOTE.
};

/** T0.5, decided: народните читалища are a LABELLED SUB-GROUP, not members of
 *  the roll-up and not excluded either. They are ~86 buyers / €18.05m of
 *  procurement, €22.1m of ИСУН grants across 1,196 beneficiaries and €18.3m of
 *  ДФЗ subsidy — the largest culture stream by beneficiary count and the only
 *  culture presence in the farm-subsidy corpus at all.
 *
 *  They are not enumerated by EIK here, and deliberately so: there are ~3,000 of
 *  them, they turn over, and every one carries „читалище“ in its name. The set
 *  is defined by `chitalishteNameSql()` in `cultureMatch.ts` — a NAME rule for a
 *  population no allowlist can track — and the register gate treats a name match
 *  there as classified. */
export const CHITALISHTE_NOTE =
  "Народните читалища са самостоятелни юридически лица с общинско делегиране; " +
  "броят им се мени, затова групата се определя по име, а не по списък с ЕИК.";

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
    bg: "ИА „Национален филмов център“",
    en: "National Film Center (executive agency)",
    noteBg: "субсидира филмовата продукция · извън ЗОП",
    noteEn: "subsidises film production · outside procurement",
  },
  {
    eik: NCF_EIK,
    bg: "Национален фонд „Култура“",
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
