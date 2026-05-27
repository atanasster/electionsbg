// Classify an awarder by tier so the by_settlement aggregator knows
// whether its HQ is a meaningful proxy for *where the contract was spent*.
//
// Tiers fall into two groups:
//
//   LOCAL-HQ-ACCURATE — HQ = jurisdiction or service area. Safe to pin to
//   the buyer's settlement on the public map.
//     - municipal       Община X        (HQ = municipality seat)
//     - school          училище/гимназия/детска градина
//     - hospital        болница/МБАЛ/УМБАЛ/СБАЛ/ДКЦ
//     - university      университет/академия (campus city)
//     - forestry        ДГС/ДЛС
//     - regional_gov    РИОСВ/РЗИ/РУО/Областна дирекция
//     - utility         ВиК/Електроразпр./локални ТЕЦ-ове
//
//   NATIONAL — Sofia HQ procures nationally. NOT safe to pin; aggregate
//   into a separate national rollup.
//     - central_ministry   Министерство X
//     - central_agency     Агенция X / ДА X / ИА X / Сметна палата
//     - national_state_co  НЕК / БДЖ / Пристанищна инфраструктура /
//                          Електроенергиен системен оператор
//
//   OTHER — heuristics couldn't classify; treat as national by default
//   (conservative — better to under-attribute than to falsely flag a
//   Sofia ministry as if it served Sofia city).
//
// The 56 manually-curated overrides at the bottom of the file catch the
// long tail (BAS institutes, military units, MVR sub-units, BNB, NHIF
// regional offices, AEC Kozloduy, etc.) where the name pattern goes the
// wrong way.

export type AwarderTier =
  | "municipal"
  | "school"
  | "hospital"
  | "university"
  | "forestry"
  | "regional_gov"
  | "utility"
  | "central_ministry"
  | "central_agency"
  | "national_state_co"
  | "other";

export const LOCAL_TIERS: ReadonlySet<AwarderTier> = new Set([
  "municipal",
  "school",
  "hospital",
  "university",
  "forestry",
  "regional_gov",
  "utility",
]);

export const isLocalTier = (t: AwarderTier): boolean => LOCAL_TIERS.has(t);

// Curated EIK → tier overrides. Used where name heuristics miss:
//   - National state companies with non-obvious names (НЕК, АЕЦ Козлодуй
//     would be flagged "utility" by name but they serve nationally).
//   - BAS / agricultural research institutes that match "Институт по" but
//     are central-research with national procurement footprint.
//   - Military and MVR units in Sofia.
//   - Regional NHIF offices that match "регионална" but procure for
//     one oblast (local — opposite override).
//
// Format: { "EIK": "tier" }. Add an entry when you spot a misclassification
// in data/procurement/awarder_tier_unclassified.json (emitted by the
// classifier during the daily run for review).
const OVERRIDES: Record<string, AwarderTier> = {
  // National state companies — Sofia HQ, national footprint
  "106513772": "national_state_co", // АЕЦ Козлодуй
  "175201304": "national_state_co", // Електроенергиен системен оператор
  "175133827": "national_state_co", // Български енергиен холдинг
  "000649348": "national_state_co", // НЕК ЕАД (Национална електрическа компания)
  "833017552": "national_state_co", // Мини Марица-Изток
  "121683785": "national_state_co", // Столичен електротранспорт (Sofia-only — kept national since it serves Sofia from a central HQ; the city map already shows Sofia separately)
  "121683408": "national_state_co", // Столичен автотранспорт (same reasoning)
  "130316140": "national_state_co", // Пристанищна инфраструктура
  "130823243": "national_state_co", // Национална компания Железопътна инфраструктура
  "000695089": "central_agency", // АПИ — Агенция Пътна Инфраструктура (national road network)
  "831160078": "national_state_co", // Напоителни системи
  "130175000": "utility", // Софийска вода — local (serves only Sofia)
  "175363846": "national_state_co", // АЙ СИ ДЖИ БИ — gas pipeline JV (national infra)

  // Military / security / Sofia HQ
  "129000273": "central_agency", // Военномедицинска академия (national, MoD)
  "129007218": "central_agency", // Медицински институт на МВР

  // Central health bodies that don't match patterns
  "000662721": "central_agency", // НЦЗПБ — Национален център по заразни и паразитни болести (note: source has typo ЦЕНТЬР)

  // BAS / national research institutes (matched "Институт по" → falsely uni)
  // none observed in the 2026 sample that we need to flip — re-evaluate
  // when an unclassified report flags them
};

// JavaScript regex `\b` only fires on ASCII word boundaries, so it fails
// on Cyrillic. We use `(?=\s|$|[^\p{L}])` ("followed by space, end, or
// non-letter") or just drop the boundary where the prefix alone is unique
// enough. All patterns below use `i` flag (case-insensitive — АОП mixes
// ALL-CAPS and Title Case) and `u` flag (Unicode-aware).
const END = "(?=\\s|$|[^\\p{L}])"; // post-token boundary that works for Cyrillic

// Heuristic rules, evaluated in order. First match wins.
const HEURISTICS: Array<{ tier: AwarderTier; rx: RegExp }> = [
  // Municipality — most specific; "Столична община" matches the city of
  // Sofia; "Община X" the others; Sofia city rayoni ("РАЙОН Лозенец" etc.)
  // are sub-municipal but bind to Sofia city, treat as municipal. Beware
  // "Областна управа" which is regional_gov not municipal.
  {
    tier: "municipal",
    rx: new RegExp(
      `^(община|столична община|район\\s+"[^"]+"|район\\s+\\S+\\s*-|кметство|общинско предприятие)${END}`,
      "iu",
    ),
  },

  // Central ministry / cabinet / parliament — always Sofia
  {
    tier: "central_ministry",
    rx: new RegExp(
      `^(министерство|министерски съвет|народно събрание|администрация на президент|конституционен съд|върховен (касационен|административен) съд|висш съдебен съвет)${END}`,
      "iu",
    ),
  },

  // Central agencies — match standalone Агенция/ДА/ИА; deliberately do not
  // match "Държавно горско стопанство" or "Държавна агенция" prefixes that
  // are forestry-like. Also catches central MVR units (Главна дирекция /
  // ГДГП / ГДПБЗН / ГД Жандармерия), military formations, central
  // directorates within ministries.
  {
    tier: "central_agency",
    rx: new RegExp(
      `^(агенция|държавна агенция|изпълнителна агенция|национална агенция|национален статистически институт|сметна палата|комисия за|национален осигурителен институт|главна дирекция|сухопътни войски|военно формирование|военновъздушни сили|военноморски сили|военна академия|ввму|национална служба|национален институт за|национален център по|национален център за|дирекция управление на собствеността)${END}`,
      "iu",
    ),
  },

  // Regional gov branches — РИОСВ, РЗИ, РУО, ОДМВР, областни управи,
  // териториални дирекции, областни пътни управления, столична дирекция
  // на МВР (Sofia oblast's MVR branch).
  {
    tier: "regional_gov",
    rx: new RegExp(
      `^(риосв|рзи|руо|одмвр|областна управа|областна администрация|областна дирекция|областно пътно управление|регионална дирекция|регионална библиотека|регионален исторически музей|регионален музей|териториално поделение на национален осигурителен|териториална дирекция|регионална здравна инспекция|регионално управление на образованието|регионална здравноосигурителна каса|районна здравноосигурителна каса|столична дирекция на вътрешните работи|столична регионална здравна|дирекция на природен парк)${END}`,
      "iu",
    ),
  },

  // Schools — broad — capture училище/гимназия/детска градина plus the
  // numeric prefix patterns (78 СУ, 192-РО СУ, etc.) Includes "начално
  // училище" and visual-arts/строително schools as well.
  {
    tier: "school",
    rx: /(основно училище|начално училище|средно училище|професионална гимназия|спортно училище|висше строително училище|гимназия|обединено училище|детска градина|обединена детска|целодневна детска|общинско училище|образцово училище|национална гимназия|национална професионална гимназия|национална профилирана гимназия|национална музикална академия|учебен комплекс|национален стем център|национален учебен комплекс|^\d+[.\- ]*(?:ро|во)?\s*(?:соу|сoу|су|оу|пг|нпг|спг|сбу|нпгм))/iu,
  },

  // Hospitals / medical centres. АОП data has inconsistent spacing/punctuation
  // around "диагностично-консултативен център" — match the loose form too.
  {
    tier: "hospital",
    rx: /(болница|мбал|умбал|сбал|сбплр|дкц|диагностично\s*[-‐–]?\s*консултативен\s+център|медицински център|онкологичен|кардиологичен|психиатричн|център за психично здраве|център за спешна медицинска|цсмп|център за кожно-венерически|център за трансфузионна|многопрофилна болница|специализирана болница)/iu,
  },

  // Universities / academies (research-heavy)
  {
    tier: "university",
    rx: /(университет|академия|висше училище|медицински университет|технически университет|нбу|вву|вту|национална художествена)/iu,
  },

  // Forestry — ДГС / ДЛС / горско стопанство / ловно стопанство
  {
    tier: "forestry",
    rx: new RegExp(
      `(държавно горско стопанство|държавно ловно стопанство|държавно лесничейство|югозападно държавно|северозападно държавно|югоизточно държавно|североизточно държавно|южноцентрално държавно|севернобългарско държавно|югоцентрално|териториално поделение "държавно (горско|ловно)|тп\\s+(дгс|длс)|(?:^|[^\\p{L}])(дгс|длс)${END})`,
      "iu",
    ),
  },

  // Utilities — ВиК / Електроразпределение / local ТЕЦ-ове / city transit
  // (метрополитен, тролейбусен, общински пътнически), regional ports.
  {
    tier: "utility",
    rx: new RegExp(
      `(водоснабдяване и канализация|водоснабдяване|електроразпределение|електроразпределителни мрежи|енергоразпределение|топлофикация|водоканал|теплоснабдяване|метрополитен|тролейбусен транспорт|трамваен транспорт|градски транспорт|общински пътнически транспорт|пристанище\\s|пристанище\\b|мрежови експлоатационен район|(?:^|[^\\p{L}])(вик|в и к|тец|аец)${END})`,
      "iu",
    ),
  },

  // State enterprises — catch-all for ДП / ЕАД after the local-tier
  // checks have run. Most regional ЕАД-ове are utilities or hospitals
  // (already matched); what survives here is usually national. Also
  // catches БДЖ-ПП (passenger rail), Информационно обслужване (state IT).
  {
    tier: "national_state_co",
    rx: new RegExp(
      `(национална компания|държавно предприятие|национален фонд|държавен фонд|държавна консолидационна|информационно обслужване|^"?бдж|^"бдж|"бдж-|(?:^|[^\\p{L}])дп${END})`,
      "iu",
    ),
  },

  // Research / scientific institutes — BAS, agricultural research, central
  // research centres. Default to central — most belong to BAS or to a
  // ministry and procure with national-tier dynamics (foreign instruments,
  // EU-funded research, capital equipment). Local agricultural research
  // stations are the exception but they're a tiny share.
  {
    tier: "central_agency",
    rx: /^(институт по|научен център|научноизследователск|институт за|институт “|институт "|добруджански земеделски институт|земеделски институт)/iu,
  },
];

export const classifyAwarder = (
  eik: string,
  name: string | undefined,
): AwarderTier => {
  if (OVERRIDES[eik]) return OVERRIDES[eik];
  const n = (name ?? "").trim();
  if (!n) return "other";
  for (const { tier, rx } of HEURISTICS) {
    if (rx.test(n)) return tier;
  }
  return "other";
};
