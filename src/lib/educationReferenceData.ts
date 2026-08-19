// Образование и наука (МОН) reference data — the hand-curated EIK universe for the
// education sector pack, mirroring src/lib/socialReferenceData.ts /
// regionalReferenceData.ts (a TS constant, not a generated crosswalk).
//
// WHAT THIS SET IS. Five universes: the ministry, its own agencies and state
// companies, the state higher-education institutions whose ПРБ is МОН, and the two
// research academies — БАН and Селскостопанската академия. 126 EIKs for 125
// institutions (Свищов changed EIK — see `retiredEikOf`), ~€2.11bn cumulative
// (2011-2026).
//
// ⚠ WHY IT EXISTS AT ALL. Until the 2026-08-18 audit the sector rolled up ONE EIK —
// МОН's — so `/sector/edu` showed €506M against a real €2.11bn, and on its DEFAULT
// scope (the current parliament) it showed **€3.17M over 9 contracts**, one supplier
// of which held 72.3%. Every state university was in no sector at all: /education is
// the schools/matura tier, so higher education was reachable only by knowing an
// awarder EIK. Same shape as the transport audit, which showed €3.7M for a real
// €348.2M. See docs/plans/education-sector-audit-v1.md.
//
// ⚠ CURATE BY EIK ALLOWLIST, NEVER BY NAME REGEX — and this sector is the sharpest
// case of that rule in the repo, because BOTH obvious patterns fail catastrophically:
//   * „университет" — the top ELEVEN hits by € are university HOSPITALS: УМБАЛ
//     „Св. Георги" €1.39bn, ВМА €1.15bn, УМБАЛ „Св. Иван Рилски" €0.87bn, УМБАЛ
//     „Д-р Георги Странски" €0.70bn … all health/defense, none education. A single
//     one of them would be a bigger error than the whole set is worth.
//   * „БАН" — matches Българска НАродна БАнка (€236.1M) and every община with
//     „Банско" / „баня" / „Бани" in its name (Банско €106.6M, Павел баня €65.0M,
//     Минерални бани €54.1M, Сапарева баня €34.6M, Баните €32.4M).
// Every row below was resolved by EIK against the procurement corpus and verified to
// be claimed by no other sector.
//
// ⚠ FOUR STATE HIGHER SCHOOLS ARE DELIBERATELY ABSENT, and it is not an oversight —
// each is curated into the sector of its actual budget principal, which is what the
// other sectors' allowlists mean, and `sector_stats.data.test.ts` refuses an EIK that
// is a member of two sector dashboards. Do NOT "complete the ЗВО roster" here:
//   * ВВМУ „Н. Й. Вапцаров" (129004492), НВУ „Васил Левски" (129009094) and Военна
//     академия „Г. С. Раковски" (129003305) are ПРБ към МО → defenseReferenceData.ts.
//   * Академия на МВР (129001232) is ПРБ към МВР → securityReferenceData.ts.
// All four were VERIFIED present in those packs' member lists, not merely assumed to
// be. EDUCATION_EXTERNAL_HIGHER_SCHOOLS below is the machine-readable form of this
// paragraph, and `educationFootnote()` below builds the awarders-tile footnote from
// it, so the page STATES that the roster is not the whole ЗВО list rather than
// implying it is.
//
// ⚠⚠ THE THREE ART ACADEMIES AND THE THREE БАН MUSEUM-INSTITUTES BELONG HERE, and the
// first draft of this file wrongly excluded all six "to culture". Read this before
// removing them again, because the mistake is a natural one to repeat:
// `kulturaReferenceData.ts` carries BOTH an allowlist and an `EXCLUDED_EIKS`
// ANTI-allowlist, and grepping that file for an EIK finds it either way. All six are
// in the ANTI-allowlist — culture explicitly DISCLAIMS them, recording БАН / higher-ed
// МОН as the principal rather than МК. НХА (000670716) and НМА (000670709) appear in
// no other reference-data file at all. Excluding them put six institutions in NO sector —
// reproducing the exact defect this file exists to fix — and would have made the
// awarders-tile footnote assert something false about six named institutions.
// Verify ownership against `SECTOR_DASHBOARDS` members / `SECTOR_BROWSE_PACKS` eiks,
// never against the presence of a string in a sibling file.
//
// Two near-misses that look like they belong and genuinely do not: НИМХ (000663814)
// LEFT БАН in 2019 and is in the environment set, and Националният институт на
// правосъдието (131177220) is judiciary. Both are claimed there, checked the same way.
//
// ⚠ THE GROUP SPANS THREE BUDGET PRINCIPALS WHILE THE HUB HEADLINE SPANS ONE, so the
// two are NOT a ratio. The /governance/sectors tile reads basis='budget' from
// EDU_BUDGET_NODE — МОН's own enacted expenditure — which covers the ministry and its
// agencies and NOTHING else here: the state universities are separate ПРБ drawing
// their subsidy straight from the central budget (МОН's whole higher-education
// programme is €48.5M in 2026, against €1.27bn of university procurement), БАН is
// autonomous, and ССА is второстепенен разпоредител към министъра на земеделието.
// Same accounting seam as ДАЗД in socialReferenceData.ts, one tier wider. Nor does the
// headline cover the delegated municipal school budgets, which are the biggest slice
// of the function: COFOG GF09 is €4.455bn for 2024 against the node's €579.4M.
// Do not "fix" the gap by summing this group's procurement onto the budget figure —
// they are different bases and adding them means nothing.
//
// EIKs resolved + € measured from the procurement corpus (contracts.awarder_eik,
// 2026-08-18). Canonical Bulgarian labels below; the corpus carries spelling variants
// per EIK — several of them actively misleading, which is why awarderNameOverrides.ts
// folds EDU_ENTITIES in: without it 123024538 resolves to
// „Медицински факултет към Тракийски университет" and 831917453 to „„Студентски
// столове и общежития" ЕАД ЕАД".

import { MON_EIK } from "./monBenchmarks";

/** Министерство на образованието и науката — the group lead. Re-exported rather than
 *  restated: the digits have one home, in monBenchmarks.ts beside the МОН pack. */
export const EDU_LEAD_EIK = MON_EIK;

/** The МОН node in the per-ministry budget tree (data/budget/ministries/<id>.json).
 *  What the /governance/sectors tile fronts (basis='budget') — read the third ⚠ above
 *  before treating it as a denominator for anything in this file. */
export const EDU_BUDGET_NODE = "admin-ministerstvo-na-obrazovanieto-i-naukata";

/** The five education "universes" — label every group tile with which it covers. */
export type EducationUniverse =
  | "ministry" // МОН (централа)
  | "agency" // МОН's agencies, centres, state companies and РУО
  | "higher_education" // държавни висши училища с ПРБ МОН
  | "research_ban" // Българска академия на науките + институти
  | "research_ssa"; // Селскостопанска академия + институти (ПРБ: МЗХ)

export interface EducationEntity {
  eik: string;
  /** Canonical Bulgarian label (corpus carries spelling variants per EIK). */
  name: string;
  universe: EducationUniverse;
  /** This row is a RETIRED EIK of the institution now filing under the named one —
   *  a genuine EIK change, not an alias, so both rows are kept and the € is not
   *  double-counted (the two contract sets are disjoint in time).
   *
   *  ⚠ It exists so that "how many institutions" can be answered separately from
   *  "how many EIKs". They differ by exactly this many, and prose that quotes one
   *  where it means the other is a false claim about the sector: the footnote said
   *  „34 държавни висши училища" for 33 institutions until this field existed. */
  retiredEikOf?: string;
}

// One row per distinct EIK, lead first. See the header for what is deliberately out.
export const EDU_ENTITIES: EducationEntity[] = [
  { eik: EDU_LEAD_EIK, name: "Министерство на образованието и науката", universe: "ministry" }, // prettier-ignore

  // ---- Агенции, центрове, държавни дружества и РУО --------------------------
  // Двете държавни дружества на МОН. ССО е най-големият възложител в тази група
  // след министерството; „Ученически отдих и спорт" е и възложител (€5.5M), и
  // изпълнител по договори на самото МОН (€16.5M) — вж. EDU_* бележката за
  // вътрешногруповия оборот в docs/plans/education-sector-audit-v1.md.
  { eik: "831917453", name: "„Студентски столове и общежития“ ЕАД (ССО)", universe: "agency" }, // prettier-ignore
  { eik: "175030371", name: "„Ученически отдих и спорт“ ЕАД", universe: "agency" }, // prettier-ignore
  { eik: "130176603", name: "Национален студентски дом", universe: "agency" }, // prettier-ignore

  { eik: "831604711", name: "Национален център за информация и документация (НАЦИД)", universe: "agency" }, // prettier-ignore
  { eik: "177224179", name: "Изпълнителна агенция „Програма за образование“", universe: "agency" }, // prettier-ignore
  { eik: "175110821", name: "Център за образователна интеграция на децата и учениците от етническите малцинства (ЦОИДУЕМ)", universe: "agency" }, // prettier-ignore
  { eik: "175467353", name: "Фонд „Научни изследвания“", universe: "agency" }, // prettier-ignore
  { eik: "177480148", name: "Държавна агенция за научни изследвания и иновации (ДАНИИ)", universe: "agency" }, // prettier-ignore

  // Изпитната администрация. „Институт по образованието" (2024) е сливането, което
  // днес възлага отпечатването на изпитните материали за ДЗИ/НВО и Единната
  // информационна система за изпити и прием; НИОКСО и ЦОПУО са предшествениците и
  // остават тук, защото носят история, която наследникът няма. Никой списък, съставен
  // по имена на агенции, не намира 181260010 — вж. одита.
  { eik: "181260010", name: "Институт по образованието", universe: "agency" }, // prettier-ignore
  { eik: "175134459", name: "Национален институт за обучение и квалификация в системата на образованието (НИОКСО)", universe: "agency" }, // prettier-ignore
  { eik: "131426401", name: "Център за оценяване в предучилищното и училищното образование (ЦОПУО)", universe: "agency" }, // prettier-ignore

  // Регионалните управления на образованието (РУО) — само петте, които имат договори
  // в корпуса. 825227007 се води под старото си име „Регионален инспекторат".
  { eik: "825227007", name: "Регионално управление на образованието — Пловдив", universe: "agency" }, // prettier-ignore
  { eik: "812118128", name: "Регионално управление на образованието — Бургас", universe: "agency" }, // prettier-ignore
  { eik: "831903375", name: "Регионално управление на образованието — София-град", universe: "agency" }, // prettier-ignore
  { eik: "827164163", name: "Регионално управление на образованието — Русе", universe: "agency" }, // prettier-ignore
  { eik: "000025459", name: "Регионално управление на образованието — Благоевград", universe: "agency" }, // prettier-ignore

  // ---- Държавни висши училища (ПРБ: МОН) -----------------------------------
  { eik: "000670680", name: "Софийски университет „Св. Климент Охридски“", universe: "higher_education" }, // prettier-ignore
  { eik: "831385737", name: "Медицински университет — София", universe: "higher_education" }, // prettier-ignore
  { eik: "831917834", name: "Технически университет — София", universe: "higher_education" }, // prettier-ignore
  { eik: "000455471", name: "Медицински университет — Пловдив", universe: "higher_education" }, // prettier-ignore
  { eik: "000083633", name: "Медицински университет „Проф. д-р Параскев Стоянов“ — Варна", universe: "higher_education" }, // prettier-ignore
  { eik: "000670602", name: "Университет за национално и световно стопанство (УНСС)", universe: "higher_education" }, // prettier-ignore
  // Корпусът разрешава този ЕИК до „Медицински факултет към Тракийски университет";
  // ЕИК-ът е на самия университет (1 320 договора под пет изписвания).
  { eik: "123024538", name: "Тракийски университет — Стара Загора", universe: "higher_education" }, // prettier-ignore
  { eik: "000405689", name: "Медицински университет — Плевен", universe: "higher_education" }, // prettier-ignore
  { eik: "000017149", name: "Югозападен университет „Неофит Рилски“ — Благоевград", universe: "higher_education" }, // prettier-ignore
  { eik: "000083626", name: "Технически университет — Варна", universe: "higher_education" }, // prettier-ignore
  { eik: "000670627", name: "Национална спортна академия „Васил Левски“", universe: "higher_education" }, // prettier-ignore
  { eik: "000455457", name: "Пловдивски университет „Паисий Хилендарски“", universe: "higher_education" }, // prettier-ignore
  { eik: "000670616", name: "Университет по архитектура, строителство и геодезия (УАСГ)", universe: "higher_education" }, // prettier-ignore
  { eik: "000670634", name: "Лесотехнически университет (ЛТУ)", universe: "higher_education" }, // prettier-ignore
  { eik: "000670673", name: "Химикотехнологичен и металургичен университет (ХТМУ)", universe: "higher_education" }, // prettier-ignore
  { eik: "000455440", name: "Университет по хранителни технологии — Пловдив", universe: "higher_education" }, // prettier-ignore
  { eik: "000083619", name: "Икономически университет — Варна", universe: "higher_education" }, // prettier-ignore
  { eik: "000522685", name: "Русенски университет „Ангел Кънчев“", universe: "higher_education" }, // prettier-ignore
  { eik: "000670659", name: "Минно-геоложки университет „Св. Иван Рилски“", universe: "higher_education" }, // prettier-ignore
  { eik: "000044541", name: "Университет „Проф. д-р Асен Златаров“ — Бургас", universe: "higher_education" }, // prettier-ignore
  { eik: "000210319", name: "Технически университет — Габрово", universe: "higher_education" }, // prettier-ignore
  { eik: "104025653", name: "Великотърновски университет „Св. св. Кирил и Методий“", universe: "higher_education" }, // prettier-ignore
  { eik: "000670545", name: "Висше училище по телекомуникации и пощи (ВУТП)", universe: "higher_education" }, // prettier-ignore
  { eik: "000934863", name: "Шуменски университет „Епископ Константин Преславски“", universe: "higher_education" }, // prettier-ignore
  // ⚠ ДВА ЕИК-а ЗА ЕДНА АКАДЕМИЯ, И ТОВА НЕ Е ДУБЛИРАНЕ. Договорите им са напълно
  // разделени във времето — 040624317 е 2011-2015, 000124026 е 2016-2026 — т.е.
  // това е СМЯНА на ЕИК, а не псевдоним, който да брои една сума два пъти. И двата
  // са нужни, за да е пълна историята на институцията; премахването на стария реже
  // €2.9M и пет години. Вж. Failure mode F в /audit-sectors.
  { eik: "000124026", name: "Стопанска академия „Д. А. Ценов“ — Свищов", universe: "higher_education" }, // prettier-ignore
  // Името е БЕЗ уточнение „предишен ЕИК": този списък се влива в
  // AWARDER_NAME_OVERRIDES, което го прави заглавието на самата страница
  // /awarder/040624317 — а уточнението е факт за ТОЗИ регистър, не част от
  // името на институцията.
  { eik: "040624317", name: "Стопанска академия „Д. А. Ценов“ — Свищов", universe: "higher_education", retiredEikOf: "000124026" }, // prettier-ignore
  { eik: "000455464", name: "Аграрен университет — Пловдив", universe: "higher_education" }, // prettier-ignore
  { eik: "000670552", name: "Университет по библиотекознание и информационни технологии (УниБИТ)", universe: "higher_education" }, // prettier-ignore
  { eik: "131209472", name: "Висше транспортно училище „Тодор Каблешков“", universe: "higher_education" }, // prettier-ignore
  { eik: "115013887", name: "Академия за музикално, танцово и изобразително изкуство „Проф. Асен Диамандиев“ — Пловдив", universe: "higher_education" }, // prettier-ignore
  { eik: "131207254", name: "Висше строително училище „Любен Каравелов“", universe: "higher_education" }, // prettier-ignore
  // Трите художествени академии. Изкуствоведски по предмет, но държавни висши
  // училища по статут — и културният сектор изрично се отказва от тях в своя
  // EXCLUDED_EIKS (за НАТФИЗ с основание „higher-ed / МОН"). Вж. второто ⚠ горе.
  { eik: "000670716", name: "Национална художествена академия (НХА)", universe: "higher_education" }, // prettier-ignore
  { eik: "000670709", name: "Национална музикална академия „Проф. Панчо Владигеров“", universe: "higher_education" }, // prettier-ignore
  { eik: "000670723", name: "НАТФИЗ „Кръстьо Сарафов“", universe: "higher_education" }, // prettier-ignore

  // ---- Българска академия на науките + институти ---------------------------
  { eik: "000662018", name: "Българска академия на науките (БАН)", universe: "research_ban" }, // prettier-ignore
  { eik: "175905727", name: "Институт по информационни и комуникационни технологии — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000662089", name: "Институт по електрохимия и енергийни системи — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "175905481", name: "Институт по роботика — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000663668", name: "Институт по органична химия с център по фитохимия — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000662064", name: "Институт по металознание, съоръжения и технологии „Акад. А. Балевски“ — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000080612", name: "Институт по океанология „Фритьоф Нансен“ — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000663675", name: "Институт по молекулярна биология „Акад. Румен Цанев“ — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000663718", name: "Институт по механика — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "831654397", name: "Институт по астрономия с Национална астрономическа обсерватория — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000663725", name: "Институт по обща и неорганична химия — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000665295", name: "Институт по полимери — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000663764", name: "Институт по физикохимия „Акад. Ростислав Каишев“ — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "175905780", name: "Институт по оптически материали и технологии „Акад. Йордан Малиновски“ — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000662025", name: "Институт по физика на твърдото тяло „Акад. Георги Наджаков“ — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "175905823", name: "Национален институт по геофизика, геодезия и география — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000665249", name: "Институт по математика и информатика — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "831375369", name: "Ботаническа градина — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000629048", name: "Издателство на БАН „Проф. Марин Дринов“", universe: "research_ban" }, // prettier-ignore
  { eik: "831906364", name: "Институт по минералогия и кристалография „Акад. Иван Костов“ — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000665270", name: "Централна лаборатория по слънчева енергия и нови енергийни източници — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000663694", name: "Институт по електроника „Акад. Емил Джаков“ — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000662139", name: "Институт по биология и имунология на размножаването „Акад. Кирил Братанов“ — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "175905702", name: "Институт за космически изследвания и технологии — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "175905652", name: "Институт по биоразнообразие и екосистемни изследвания — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "175905455", name: "Институт по биофизика и биомедицинско инженерство — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000665352", name: "Геологически институт „Страшимир Димитров“ — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000663757", name: "Институт по инженерна химия — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000663700", name: "Институт по микробиология „Стефан Ангелов“ — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000710936", name: "Институт по катализ — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "175905570", name: "Институт по физиология на растенията и генетика — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000674910", name: "Централна лаборатория по приложна физика — БАН, Пловдив", universe: "research_ban" }, // prettier-ignore
  { eik: "000665231", name: "Институт за ядрени изследвания и ядрена енергетика — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "175905638", name: "Институт по експериментална морфология, патология и антропология с музей — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000663747", name: "Институт по невробиология — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000665509", name: "Институт за литература — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000662192", name: "Институт за гората — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000665644", name: "Централна библиотека на БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "175906003", name: "Институт по философия и социология — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000671049", name: "Институт за исторически изследвания — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "831143303", name: "Кирило-Методиевски научен център — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "121578453", name: "Център за обучение — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000628749", name: "Социално-битов комплекс — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "177333837", name: "Общоакадемично помощно звено „Почивно дело“ — БАН", universe: "research_ban" }, // prettier-ignore
  // Трите института на БАН с музей. Културният сектор ги изключва изрично като
  // „БАН" — те са институти на Академията, а не музеи на МК. Вж. второто ⚠ горе.
  { eik: "000670919", name: "Национален археологически институт с музей — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "175905773", name: "Институт за етнология и фолклористика с Етнографски музей — БАН", universe: "research_ban" }, // prettier-ignore
  { eik: "000665612", name: "Национален природонаучен музей — БАН", universe: "research_ban" }, // prettier-ignore

  // ---- Селскостопанска академия + институти (ПРБ: МЗХ, вж. заглавието) ------
  { eik: "000662107", name: "Селскостопанска академия (ССА)", universe: "research_ssa" }, // prettier-ignore
  { eik: "000840410", name: "Добруджански земеделски институт — Генерал Тошево", universe: "research_ssa" }, // prettier-ignore
  { eik: "123650307", name: "Земеделски институт — Стара Загора", universe: "research_ssa" }, // prettier-ignore
  { eik: "123650036", name: "Институт по полски култури — Чирпан", universe: "research_ssa" }, // prettier-ignore
  { eik: "102674956", name: "Институт по земеделие — Карнобат", universe: "research_ssa" }, // prettier-ignore
  { eik: "000512495", name: "Институт по земеделие и семезнание „Образцов чифлик“ — Русе", universe: "research_ssa" }, // prettier-ignore
  { eik: "127526189", name: "Земеделски институт — Шумен", universe: "research_ssa" }, // prettier-ignore
  { eik: "148078636", name: "Институт по рибни ресурси — Варна", universe: "research_ssa" }, // prettier-ignore
  { eik: "110544670", name: "Институт по планинско животновъдство и земеделие — Троян", universe: "research_ssa" }, // prettier-ignore
  { eik: "130458200", name: "Институт по животновъдни науки — Костинброд", universe: "research_ssa" }, // prettier-ignore
  { eik: "106524772", name: "Институт по царевицата — Кнежа", universe: "research_ssa" }, // prettier-ignore
  { eik: "000662160", name: "Институт по почвознание, агротехнологии и защита на растенията „Никола Пушкаров“", universe: "research_ssa" }, // prettier-ignore
  { eik: "130455211", name: "Агробиоинститут", universe: "research_ssa" }, // prettier-ignore
  { eik: "000450524", name: "Институт по растителни генетични ресурси „К. Малков“ — Садово", universe: "research_ssa" }, // prettier-ignore
  { eik: "177259251", name: "Научен център по земеделие — Търговище", universe: "research_ssa" }, // prettier-ignore
  { eik: "114537755", name: "Институт по лозарство и винарство — Плевен", universe: "research_ssa" }, // prettier-ignore
  { eik: "200450056", name: "ДП „Експериментална база към Института по планинско животновъдство и земеделие“ — Троян", universe: "research_ssa" }, // prettier-ignore
  { eik: "115772635", name: "Институт по тютюна и тютюневите изделия — Марково", universe: "research_ssa" }, // prettier-ignore
  { eik: "115602768", name: "Институт по овощарство — Пловдив", universe: "research_ssa" }, // prettier-ignore
  { eik: "177259212", name: "Научен център по животновъдство и земеделие — Смолян", universe: "research_ssa" }, // prettier-ignore
  { eik: "114537787", name: "Институт по фуражните култури — Плевен", universe: "research_ssa" }, // prettier-ignore
  { eik: "115602330", name: "Институт по зеленчукови култури „Марица“ — Пловдив", universe: "research_ssa" }, // prettier-ignore
  { eik: "200467900", name: "Опитна станция по земеделие — Лозница", universe: "research_ssa" }, // prettier-ignore
  { eik: "160078022", name: "Институт по рибарство и аквакултури — Пловдив", universe: "research_ssa" }, // prettier-ignore
  { eik: "130455243", name: "Институт по криобиология и хранителни технологии", universe: "research_ssa" }, // prettier-ignore
  { eik: "200470799", name: "Опитна станция по земеделие — Търговище", universe: "research_ssa" }, // prettier-ignore
  { eik: "200451674", name: "Опитна станция по животновъдство и земеделие — Смолян", universe: "research_ssa" }, // prettier-ignore
  { eik: "160078200", name: "Институт по консервиране и качество на храните — Пловдив", universe: "research_ssa" }, // prettier-ignore
];

/** Where a reader should go to find an externally-held higher school. NOT always a
 *  `/sector/:id` route: `defense` is the bespoke `/defense` dashboard and has no
 *  SECTOR_DASHBOARDS entry, while `security` does. A consumer that links these must
 *  MAP the id to a path, never interpolate `/sector/${id}` — half of them would be
 *  dead links. Constrained to a union for the same reason EDU_UNIVERSE_RANK is a
 *  Record: a typo or a stale id must be a compile error, not a 404 nobody clicks. */
export type ExternalSectorId = "defense" | "security";

/** The state higher schools that ARE висши училища but sit in another sector,
 *  because their budget principal is another ministry. The machine-readable form of
 *  the first ⚠ in the header: the awarders-tile footnote is built from it, so the
 *  page can say the roster is not the whole ЗВО list instead of silently implying it
 *  is, and `sector_stats_education.data.test.ts` asserts BOTH halves — that every EIK
 *  here is absent from EDU_ENTITIES (the re-leakage tripwire) AND that it is really
 *  claimed by the named sector's own member list. The second half is the one that
 *  matters: without it, "excluded because sector X owns it" is an unchecked claim,
 *  which is exactly how six institutions were nearly stranded in no sector at all. */
export const EDUCATION_EXTERNAL_HIGHER_SCHOOLS: ReadonlyArray<{
  eik: string;
  name: string;
  /** The sector whose allowlist owns it — verified, not assumed. */
  sector: ExternalSectorId;
}> = [
  { eik: "129009094", name: "Национален военен университет „Васил Левски“", sector: "defense" }, // prettier-ignore
  { eik: "129004492", name: "Висше военноморско училище „Н. Й. Вапцаров“", sector: "defense" }, // prettier-ignore
  { eik: "129003305", name: "Военна академия „Г. С. Раковски“", sector: "defense" }, // prettier-ignore
  { eik: "129001232", name: "Академия на МВР", sector: "security" }, // prettier-ignore
];

/** Distinct INSTITUTIONS in the roster — EIK count minus the retired-EIK rows.
 *  Every reader-facing count of "how many bodies" must use this; `EDU_SECTOR_EIKS
 *  .length` is the query fan-out, which is a different question. */
export const EDU_INSTITUTION_COUNT = EDU_ENTITIES.filter(
  (e) => !e.retiredEikOf,
).length;

/** The awarders-tile footnote — the one place the page states what its € covers and
 *  what it does not. DERIVED rather than hand-written, so the counts and the names
 *  cannot drift from the roster the way RegionalPack's did (its bg line said 28 and
 *  its en line 27 for the same set). Three claims, each of which the reference data
 *  above establishes: the group spans three budget principals; the hub tile's € is
 *  МОН's own budget and covers neither the universities' separate ПРБ budgets nor the
 *  delegated municipal school budgets; and some state higher schools sit elsewhere.
 *
 *  ⚠ No count is written in this docstring either — EDUCATION_EXTERNAL_HIGHER_SCHOOLS
 *  owns that number, and a comment saying "four" is the same drift one layer up. */
export const educationFootnote = (bg: boolean): string => {
  const n = EDU_INSTITUTION_COUNT;
  // INSTITUTIONS, not EIKs — the two differ by the retired-EIK rows, and this
  // sentence is a claim about how many universities there are.
  const uni = EDU_ENTITIES.filter(
    (e) => e.universe === "higher_education" && !e.retiredEikOf,
  ).length;
  // Count AND names from ONE array. Hard-coding „Четири"/„Four" beside a derived
  // list is exactly the RegionalPack drift this function exists to avoid: a fifth
  // external school would ship a footnote saying four and listing five, with every
  // gate green.
  const ext = EDUCATION_EXTERNAL_HIGHER_SCHOOLS;
  // A trailing „и"/"and" rather than a bare comma join: this is a sentence a
  // reader finishes, not a CSV.
  const names = ext.map((e) => e.name);
  const last = names.length > 1 ? names[names.length - 1] : "";
  const others =
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} ${bg ? "и" : "and"} ${last}`
      : (names[0] ?? "");
  return bg
    ? `${n} възложителя под три бюджетни принципала: МОН и неговите структури, ${uni} държавни висши училища (самостоятелни ПРБ), БАН и Селскостопанската академия (второстепенен разпоредител към МЗХ). Числото на плочката „Образование“ в /governance/sectors е бюджетът на САМО МОН — то не включва нито субсидиите на висшите училища, нито делегираните бюджети на общинските училища, така че то и сумата на поръчките тук не се събират. Други ${ext.length} държавни висши училища са в друг сектор, защото бюджетният им принципал е друг: ${others}.`
    : `${n} awarders under three budget principals: МОН and its own bodies, ${uni} state higher-education institutions (each its own first-level spending unit), БАН, and the Agricultural Academy (a second-level unit under the agriculture ministry). The „Образование“ figure on /governance/sectors is МОН's budget ALONE — it covers neither the universities' subsidies nor the delegated municipal school budgets, so it and the procurement total here are different bases and must not be added. A further ${ext.length} state higher schools sit in another sector because their budget principal is another ministry: ${others}.`;
};

const ENTITY_BY_EIK: Record<string, EducationEntity> = Object.fromEntries(
  EDU_ENTITIES.map((e) => [e.eik, e]),
);

export const educationEntityByEik = (
  eik: string,
): EducationEntity | undefined => ENTITY_BY_EIK[eik];

export const educationUniverseOf = (
  eik: string,
): EducationUniverse | undefined => ENTITY_BY_EIK[eik]?.universe;

/** Every education-group EIK — the input to the sector-dashboard rollup, the
 *  SECTOR_BROWSE_PACKS `edu` entry and the awarder-group-model endpoint. */
export const EDU_SECTOR_EIKS: string[] = EDU_ENTITIES.map((e) => e.eik);

export const EDU_UNIVERSE_LABEL: Record<
  EducationUniverse,
  { bg: string; en: string }
> = {
  ministry: { bg: "Министерство", en: "Ministry" },
  agency: { bg: "Агенции и дружества", en: "Agencies & state companies" },
  higher_education: { bg: "Държавни висши училища", en: "State universities" },
  research_ban: { bg: "БАН", en: "Academy of Sciences (БАН)" },
  research_ssa: { bg: "Селскостопанска академия", en: "Agricultural Academy" },
};

export const educationUniverseLabel = (
  u: EducationUniverse,
  lang: string,
): string =>
  (lang === "bg" ? EDU_UNIVERSE_LABEL[u]?.bg : EDU_UNIVERSE_LABEL[u]?.en) ?? u;

/** Display rank per universe: ministry first, then broadly by corpus weight with one
 *  deliberate exception. Measured 2026-08-18 — universities €1.27bn, БАН €147.3M,
 *  agencies €130.1M, ССА €54.4M. The exception is agencies BEFORE БАН despite being
 *  slightly smaller: they are МОН's own bodies, and a reader crossing from the hub
 *  tile (whose € is МОН's budget) expects the ministry's own structures next to it.
 *  Do not "restore" strict size order — the exception is the rule here.
 *
 *  A `Record<EducationUniverse, …>` rather than a bare ordered array ON PURPOSE: the
 *  array form compiles fine with a member missing, so a new universe would type-check
 *  everywhere and simply never appear in a picker — its units silently unreachable
 *  through the segmentation. Keyed like this, omitting one is a compile error, the
 *  same way EDU_UNIVERSE_LABEL already forces a label. */
const EDU_UNIVERSE_RANK: Record<EducationUniverse, number> = {
  ministry: 0,
  agency: 1,
  higher_education: 2,
  research_ban: 3,
  research_ssa: 4,
};

/** Ordered universes for a Select / segmentation. */
export const EDU_UNIVERSES: EducationUniverse[] = (
  Object.keys(EDU_UNIVERSE_RANK) as EducationUniverse[]
).sort((a, b) => EDU_UNIVERSE_RANK[a] - EDU_UNIVERSE_RANK[b]);
