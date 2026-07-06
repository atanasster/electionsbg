// НОИ (ДОО) sector-pack reference data — single-sourced so the tiles and the
// classifier can never drift. Two kinds of orientation live here:
//
//  1. An international administrative-cost band. НОИ runs the state social-
//     insurance funds (ДОО); the honest "is the administration expensive?"
//     question is answered by admin spend (Персонал + Издръжка) as a share of
//     benefit spend, against comparable social-security carriers abroad. The
//     figures are NOT like-for-like accounting (scope and what counts as
//     "administration" differ by country) — the caption keeps that honest; the
//     point is orientation, not a league table.
//
//  2. The functional taxonomy of what НОИ buys (CPV division → an НОИ-legible
//     category) and the statutory context for its two structural suppliers,
//     whose no-competition procurement is set by law, not by choice — without
//     that context the single-bid figures read as scandal when they're statute.

/** Administrative-cost reference levels, as a share of benefit expenditure.
 *  US SSA has held administrative expenses at ~0.5–1% of benefits for decades;
 *  the German DRV carriers sit around 0.9% (Knappschaft) to 1.3% (regional). */
export const NOI_ADMIN_BENCHMARK = {
  ssa: 0.005, // US Social Security Administration — administrative ~0.5%
  drvLo: 0.009, // Deutsche Rentenversicherung Knappschaft-Bahn-See ~0.9%
  drvHi: 0.013, // DRV regional carriers ~1.3%
} as const;

/** НОИ's own published pensioner headcount (2024, all pension types) — used
 *  only as prose context for the admin ratio, never as a computed headline
 *  denominator (the funds file carries amounts, not counts). Source: НОИ
 *  statistical bulletin. */
export const NOI_PENSIONERS_2024 = 2_060_000;

export type NoiCategory =
  | "it"
  | "comms"
  | "buildings"
  | "energy"
  | "services"
  | "other";

// CPV division (first two digits) → НОИ functional category. Divisions not
// listed fall through to "other". Ordered by how НОИ actually spends: the
// pension IT backbone, postal/telecom (pension delivery), the ТП building
// stock, energy, and the services/maintenance long tail.
const CPV_TO_CATEGORY: Record<string, NoiCategory> = {
  // ИТ и системи — software, licences, computing & network hardware
  "72": "it",
  "48": "it",
  "30": "it",
  "32": "it",
  "31": "it",
  // Пощи и комуникации — postal + telecom services (pension delivery lives here)
  "64": "comms",
  // Сгради и обзавеждане — construction, real estate, furniture, cleaning
  "45": "buildings",
  "70": "buildings",
  "39": "buildings",
  "44": "buildings",
  "90": "buildings",
  // Енергия и горива — electricity, fuel, petroleum products
  "09": "energy",
  // Услуги и поддръжка — business/admin services, repair & maintenance
  "79": "services",
  "50": "services",
  "85": "services",
  "98": "services",
  "80": "services",
  "66": "services",
};

export const categoryOfCpv = (cpv: string | undefined): NoiCategory => {
  const d = String(cpv ?? "").slice(0, 2);
  return CPV_TO_CATEGORY[d] ?? "other";
};

export const NOI_CATEGORY_LABEL: Record<
  NoiCategory,
  { bg: string; en: string }
> = {
  it: { bg: "ИТ и системи", en: "IT & systems" },
  comms: { bg: "Пощи и комуникации", en: "Postal & communications" },
  buildings: { bg: "Сгради и обзавеждане", en: "Buildings & furnishing" },
  energy: { bg: "Енергия и горива", en: "Energy & fuel" },
  services: { bg: "Услуги и поддръжка", en: "Services & maintenance" },
  other: { bg: "Друго", en: "Other" },
};

export const categoryLabel = (c: NoiCategory, lang: string): string =>
  lang === "bg" ? NOI_CATEGORY_LABEL[c].bg : NOI_CATEGORY_LABEL[c].en;

// НОИ's two structural suppliers whose lack of competition is set by statute,
// not procurement choice. Surfaced as a context chip next to their single-bid
// figures so a reader doesn't mistake a legal mandate for a red flag.
export const NOI_SUPPLIER_CONTEXT: Record<
  string,
  { kind: "statutory" | "delivery"; bg: string; en: string }
> = {
  // Информационно обслужване АД — declared national systems integrator (ЗЕУ,
  // 2019); state bodies award systems work to it directly, outside ЗОП.
  "831641791": {
    kind: "statutory",
    bg: "Системен интегратор на държавата по закон (ЗЕУ, 2019) — възлагането е пряко, извън ЗОП",
    en: "Statutory national systems integrator (2019) — awarded directly, outside open tender",
  },
  // Български пощи ЕАД — pension delivery under НПОС чл. 92; the 10-year
  // mandate from 1.07.2016 expires 1.07.2026 (a state-aid SGEI arrangement).
  "121396123": {
    kind: "delivery",
    bg: "Изплащане на пенсии по НПОС чл. 92; 10-годишният мандат (от 1.07.2016) изтича на 1.07.2026",
    en: "Pension delivery under NPOS art. 92; the 10-year mandate (from 1 Jul 2016) expires 1 Jul 2026",
  },
};

export const NOI_EIK = "121082521";
