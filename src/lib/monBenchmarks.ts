// Министерство на образованието и науката (МОН) sector-pack reference data.
// EIK + the CPV→function taxonomy for the ministry's own procurement, kept next
// to the pack so the tiles and the classifier can't drift.
//
// МОН (ЕИК 000695114) is a single awarder in the corpus (no ВСС-style alias
// split), but its corpus label is the stale legacy name ("Министерство на
// образованието, младежта и науката /МОМН/…"), so the pack supplies its own
// display name.
//
// The pack's differentiator is NOT the ministry's ~€350M of direct procurement —
// it is the education money МОН does not spend itself: the €51M textbook market
// (bought by 606 schools, not centrally) and its publisher concentration. See
// src/lib/textbookPublishers.ts.

/** Министерство на образованието и науката — the pack anchor + /awarder route. */
export const MON_EIK = "000695114";

export const MON_NAME = {
  bg: "Министерство на образованието и науката",
  en: "Ministry of Education and Science (МОН)",
};

export type MonCategory =
  | "it"
  | "infrastructure"
  | "textbooks"
  | "services"
  | "supplies"
  | "other";

// CPV division (first two digits) → МОН operating function.
const CPV_TO_CATEGORY: Record<string, MonCategory> = {
  // ИТ и системи — образователни платформи, ЕИСС, лицензи, хардуер
  "72": "it",
  "48": "it",
  "30": "it",
  "32": "it",
  "31": "it",
  // Сгради и строителство — училища, ремонти, проектиране
  "45": "infrastructure",
  "70": "infrastructure",
  "71": "infrastructure",
  // Учебници и печатни материали
  "22": "textbooks",
  // Обзавеждане и консумативи
  "39": "supplies",
  "44": "supplies",
  "37": "supplies", // музикални инструменти, спорт
  // Услуги
  "79": "services",
  "80": "services", // образователни услуги
  "66": "services",
  "50": "services",
  "90": "services",
  "60": "services",
  "55": "services", // настаняване/храна (лагери, изпити)
};

export const categoryOfCpv = (cpv: string | undefined): MonCategory => {
  const d = String(cpv ?? "").slice(0, 2);
  return CPV_TO_CATEGORY[d] ?? "other";
};

export const MON_CATEGORY_LABEL: Record<
  MonCategory,
  { bg: string; en: string }
> = {
  it: { bg: "ИТ и електронно образование", en: "IT & digital education" },
  infrastructure: {
    bg: "Сгради и строителство",
    en: "Buildings & construction",
  },
  textbooks: {
    bg: "Учебници и печатни материали",
    en: "Textbooks & printed materials",
  },
  services: { bg: "Услуги", en: "Services" },
  supplies: { bg: "Обзавеждане и консумативи", en: "Furnishings & supplies" },
  other: { bg: "Друго", en: "Other" },
};

export const monCategoryLabel = (c: MonCategory, lang: string): string =>
  lang === "bg" ? MON_CATEGORY_LABEL[c].bg : MON_CATEGORY_LABEL[c].en;
