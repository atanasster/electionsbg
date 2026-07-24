// The official-category vocabulary: one bucket → its BG and EN label and its
// i18n key. Deliberately free of React and lucide imports, because the
// consumers are not all React: the AI tools render tables server-side, the
// prerenderer writes static HTML from a node script, and the funds screens want
// the i18n key.
//
// Every one of those three kept its own partial copy of the vocabulary, typed
// `Record<string, …>` so the compiler said nothing when the union grew from 4
// buckets to 25. The AI tool's category filter silently matched nothing and
// answered a narrowing question with the unfiltered list; the prerenderer gave
// ~97% of official pages generic meta text; the funds screens showed raw
// English slugs. All three now read from here.

import type { OfficialCategoryKind } from "@/data/dataTypes";

export type OfficialCategoryLabel = {
  bg: string;
  en: string;
  /** i18n key for React consumers; `en` is the fallback. */
  key: string;
  /** One-line description used for prerendered page meta. */
  descBg: string;
  descEn: string;
};

export const OFFICIAL_CATEGORY_LABELS: Record<
  OfficialCategoryKind,
  OfficialCategoryLabel
> = {
  cabinet: {
    bg: "Министри",
    en: "Cabinet",
    key: "officials_cat_cabinet",
    descBg: "Министър-председател, заместник министър-председатели и министри",
    descEn: "Prime minister, deputy prime ministers and ministers",
  },
  deputy_minister: {
    bg: "Зам.-министри",
    en: "Deputy minister",
    key: "officials_cat_deputy_minister",
    descBg: "Заместник-министър",
    descEn: "Deputy minister",
  },
  regional_governor: {
    bg: "Области",
    en: "Regional governor",
    key: "officials_cat_regional_governor",
    descBg: "Областен управител или заместник-областен управител",
    descEn: "Regional governor or deputy regional governor",
  },
  political_cabinet: {
    bg: "Политически кабинети",
    en: "Political cabinet",
    key: "officials_cat_political_cabinet",
    descBg: "Началник на политическия кабинет на министър",
    descEn: "Chief of a minister's political cabinet",
  },
  president: {
    bg: "Президентство",
    en: "Presidency",
    key: "officials_cat_president",
    descBg: "Президент и вицепрезидент на Република България",
    descEn: "President and vice-president of Bulgaria",
  },
  mep: {
    bg: "Евродепутати",
    en: "MEP",
    key: "officials_cat_mep",
    descBg: "Член на Европейския парламент от Република България",
    descEn: "Member of the European Parliament for Bulgaria",
  },
  party_leader: {
    bg: "Партийни лидери",
    en: "Party leader",
    key: "officials_cat_party_leader",
    descBg: "Председател на политическа партия, получаваща държавна субсидия",
    descEn: "Leader of a political party receiving state subsidy",
  },
  regulator: {
    bg: "Регулатори",
    en: "Regulator",
    key: "officials_cat_regulator",
    descBg: "Член на регулаторен или независим орган",
    descEn: "Member of a regulatory or independent body",
  },
  central_bank: {
    bg: "БНБ",
    en: "Central bank",
    key: "officials_cat_central_bank",
    descBg: "Управител, подуправител или член на УС на БНБ",
    descEn:
      "Governor, deputy governor or board member of the Bulgarian National Bank",
  },
  audit_court: {
    bg: "Сметна палата",
    en: "Court of Audit",
    key: "officials_cat_audit_court",
    descBg: "Председател, заместник-председател или член на Сметната палата",
    descEn: "President, vice-president or member of the Court of Audit",
  },
  secretary_general: {
    bg: "Главни секретари",
    en: "Secretary general",
    key: "officials_cat_secretary_general",
    descBg: "Главен или административен секретар в държавната администрация",
    descEn:
      "Secretary general or administrative secretary in the state administration",
  },
  inspectorate: {
    bg: "Инспекторати",
    en: "Inspectorate",
    key: "officials_cat_inspectorate",
    descBg: "Ръководител на инспекторат по Закона за администрацията",
    descEn: "Head of an inspectorate under the Administration Act",
  },
  agency_head: {
    bg: "Агенции",
    en: "Agency head",
    key: "officials_cat_agency_head",
    descBg: "Ръководител на държавна или изпълнителна агенция",
    descEn: "Head of a state or executive agency",
  },
  regional_director: {
    bg: "Регионални дирекции",
    en: "Regional director",
    key: "officials_cat_regional_director",
    descBg: "Ръководител на регионална дирекция (ОДБХ, РЗИ, ДНСК, ДФЗ, РИОСВ)",
    descEn:
      "Head of a regional directorate (food safety, health, construction, agriculture, environment)",
  },
  procurement_officer: {
    bg: "Отговорници по ЗОП",
    en: "Procurement officer",
    key: "officials_cat_procurement_officer",
    descBg:
      "Лице, упълномощено да провежда обществени поръчки и да сключва договори",
    descEn:
      "Official authorised to run public-procurement procedures and sign contracts",
  },
  eu_funds_controller: {
    bg: "Контрол на еврофондове",
    en: "EU funds control",
    key: "officials_cat_eu_funds_controller",
    descBg: "Орган за финансово управление и контрол на средства от ЕС",
    descEn: "Financial management and control body for EU funds",
  },
  revenue_agency: {
    bg: "НАП и Митници",
    en: "Revenue & customs",
    key: "officials_cat_revenue_agency",
    descBg: "Ръководство на НАП или на Агенция „Митници“",
    descEn: "Leadership of the revenue agency or the customs agency",
  },
  security_service: {
    bg: "Служби за сигурност",
    en: "Security services",
    key: "officials_cat_security_service",
    descBg:
      "Ръководство на ДАНС, ДАР, ДАТО, НСО или на главните дирекции на МВР",
    descEn:
      "Leadership of the state security, intelligence and interior-ministry directorates",
  },
  military_command: {
    bg: "Висше командване",
    en: "Military command",
    key: "officials_cat_military_command",
    descBg: "Началник на отбраната и висш команден състав на въоръжените сили",
    descEn: "Chief of defence and the senior command of the armed forces",
  },
  social_fund: {
    bg: "Осигурителни фондове",
    en: "Social funds",
    key: "officials_cat_social_fund",
    descBg: "Ръководство на НЗОК, РЗОК или НОИ",
    descEn: "Leadership of the health-insurance or social-security funds",
  },
  hospital_head: {
    bg: "Болници",
    en: "Hospital director",
    key: "officials_cat_hospital_head",
    descBg:
      "Управител или изпълнителен директор на лечебно заведение за болнична помощ",
    descEn: "Director of a publicly funded hospital",
  },
  state_enterprise: {
    bg: "Държавни предприятия",
    en: "State enterprise",
    key: "officials_cat_state_enterprise",
    descBg:
      "Член на управителен или контролен орган на държавно или общинско предприятие",
    descEn: "Board member of a state or municipal enterprise",
  },
  school: {
    bg: "Училища",
    en: "Schools",
    key: "officials_cat_school",
    descBg: "Директор или ръководен орган на държавно или общинско училище",
    descEn: "Director or governing body of a state or municipal school",
  },
  kindergarten: {
    bg: "Детски градини и ясли",
    en: "Kindergartens",
    key: "officials_cat_kindergarten",
    descBg: "Директор на детска градина, ясла или детска кухня",
    descEn: "Director of a kindergarten, nursery or children's kitchen",
  },
  social_care: {
    bg: "Социални домове",
    en: "Social-care homes",
    key: "officials_cat_social_care",
    descBg: "Директор на социален дом или център за социални услуги",
    descEn: "Director of a social-care home or centre",
  },
  medical_center: {
    bg: "Медицински центрове",
    en: "Medical centres",
    key: "officials_cat_medical_center",
    descBg:
      "Управител на ДКЦ, медицински център или център за трансфузионна хематология",
    descEn: "Director of an outpatient diagnostic, medical or transfusion centre",
  },
  cultural_institute: {
    bg: "Културни институти",
    en: "Cultural institutes",
    key: "officials_cat_cultural_institute",
    descBg: "Директор на държавен или общински културен институт",
    descEn: "Director of a state or municipal cultural institute",
  },
  agri_academy: {
    bg: "Селскостопанска академия",
    en: "Agricultural Academy",
    key: "officials_cat_agri_academy",
    descBg: "Член на управителен орган на Селскостопанската академия",
    descEn: "Governing-body member of the Agricultural Academy",
  },
  diplomat: {
    bg: "Дипломати",
    en: "Head of mission",
    key: "officials_cat_diplomat",
    descBg: "Ръководител на задгранично представителство на Република България",
    descEn: "Head of a Bulgarian diplomatic mission",
  },
  academic: {
    bg: "Ректори и БАН",
    en: "Rectors & BAS",
    key: "officials_cat_academic",
    descBg:
      "Председател на БАН, ректор на държавно висше училище или началник на военна академия",
    descEn:
      "President of the Academy of Sciences, university rector or military-academy head",
  },
  media_head: {
    bg: "Обществени медии",
    en: "Public media",
    key: "officials_cat_media_head",
    descBg: "Генерален директор на БНТ, БНР или БТА",
    descEn: "Director general of the public broadcaster or news agency",
  },
  civil_society: {
    bg: "Гражданско общество",
    en: "Civil society",
    key: "officials_cat_civil_society",
    descBg: "Член на ръководен или контролен орган на БЧК",
    descEn: "Board member of the Bulgarian Red Cross",
  },
  international: {
    bg: "Международни органи",
    en: "International bodies",
    key: "officials_cat_international",
    descBg:
      "Български гражданин в орган на ЕС, НАТО или международна организация",
    descEn: "Bulgarian national serving in an EU, NATO or international body",
  },
};

/** Display order — grouped, not alphabetical, so related buckets sit together
 *  and the political executive leads.
 *
 *  Typed as a tuple covering every member of the union: a bucket missing from
 *  here is hidden from the /officials/assets filter AND crashes the ranking
 *  generator, so the omission must be a compile error rather than a runtime
 *  surprise after a multi-hour fetch. */
export const OFFICIAL_CATEGORY_ORDER = [
  "cabinet",
  "deputy_minister",
  "regional_governor",
  "political_cabinet",
  "president",
  "mep",
  "party_leader",
  "regulator",
  "central_bank",
  "audit_court",
  "secretary_general",
  "inspectorate",
  "agency_head",
  "regional_director",
  "procurement_officer",
  "eu_funds_controller",
  "revenue_agency",
  "security_service",
  "military_command",
  "social_fund",
  "hospital_head",
  "state_enterprise",
  "school",
  "kindergarten",
  "social_care",
  "medical_center",
  "cultural_institute",
  "agri_academy",
  "diplomat",
  "academic",
  "media_head",
  "civil_society",
  "international",
] as const satisfies readonly OfficialCategoryKind[];

// Compile-time completeness: fails if a union member is missing from the order
// above. `satisfies` alone only checks that every listed member is valid, not
// that every valid member is listed.
type _OrderCoversUnion =
  OfficialCategoryKind extends (typeof OFFICIAL_CATEGORY_ORDER)[number]
    ? true
    : ["OFFICIAL_CATEGORY_ORDER is missing a category", never];
const _orderCoversUnion: _OrderCoversUnion = true;
void _orderCoversUnion;

/** Categories whose officials are always worth a static page.
 *
 *  Prerender priority is about public interest, NOT declared wealth. Ranking the
 *  cap by net worth put 608 state-enterprise managers ahead of the cabinet and
 *  dropped 55% of ministers, 33% of the president's office and 91% of regional
 *  governors out of both the prerendered set and the sitemap — the opposite of
 *  what the pages are for.
 *
 *  These are the offices a reader searches by name: the political executive, the
 *  independent bodies, the security and revenue leadership, the diplomatic and
 *  academic heads. The remainder — state enterprises, hospitals, procurement
 *  officers, EU-funds controllers, regional directorates — is the operational
 *  bulk (10,699 of 14,490); those still get a page for the wealthiest, and all
 *  of them remain fully browsable in the SPA and the DB-backed search. */
export const OFFICIAL_PRERENDER_PRIORITY: ReadonlySet<OfficialCategoryKind> =
  new Set<OfficialCategoryKind>([
    "cabinet",
    "deputy_minister",
    "regional_governor",
    "political_cabinet",
    "president",
    "mep",
    "party_leader",
    "regulator",
    "central_bank",
    "audit_court",
    "secretary_general",
    "inspectorate",
    "agency_head",
    "revenue_agency",
    "security_service",
    "military_command",
    "social_fund",
    "diplomat",
    "academic",
    "media_head",
    "civil_society",
    "international",
  ]);

/** Officials to emit a static page for, highest priority first.
 *
 *  Priority tier first, then declared net worth inside each tier. Shared by the
 *  prerenderer and the sitemap so a <loc> can never point at a page that was
 *  not built. */
export const officialsForStaticPages = <
  T extends { category: OfficialCategoryKind; netWorthEur?: number | null },
>(
  officials: readonly T[],
  limit: number,
): T[] =>
  [...officials]
    .sort(
      (a, b) =>
        Number(OFFICIAL_PRERENDER_PRIORITY.has(b.category)) -
          Number(OFFICIAL_PRERENDER_PRIORITY.has(a.category)) ||
        (b.netWorthEur ?? 0) - (a.netWorthEur ?? 0),
    )
    .slice(0, limit);

/** How many officials get a static page. Every priority-tier official (3,791)
 *  fits, with room for the wealthiest of the operational bulk. At two pages
 *  each (BG + EN) that is ~10,000 files — against ~29,000 uncapped. */
export const OFFICIALS_STATIC_PAGE_LIMIT = 5000;
