// НЗОК (National Health Insurance Fund) sector-pack reference data — the
// buyer-specific bits kept in one place so the tiles and the classifier can't
// drift. НЗОК's public procurement is a small IT-and-security operating budget
// (its ~€4.9bn of actual health spend flows OUTSIDE ЗОП — see the budget-bridge
// tile), so the functional taxonomy is built around what it actually contracts.

export const NZOK_EIK = "121858220";

// Health-insured persons in Bulgaria, for the "€ per insured person" civic
// translation on the budget-bridge hero — the OpenSpending "daily bread" move.
// НЗОК reports ~6.5 млн здравноосигурени лица (against a ~6.4M resident
// population, НСИ Census 2021 + interrupted-rights holders the fund still
// budgets for). Deliberately an approximation with a wide-enough round that a
// small yearly drift does not falsify the per-person figure; the tile footnotes
// it as such. Source: НЗОК/НСИ.
export const NZOK_INSURED_PERSONS = 6_500_000;

/** Euros per insured person for a budget-year total (rounded to whole euros). */
export const eurPerInsured = (totalEur: number): number =>
  Math.round(totalEur / NZOK_INSURED_PERSONS);

// Civic-translation anchors — turning a bare € sum into "= X of something real"
// (Диагноза's rhetorical move, but grounded and conservative here). A nurse's
// mean GROSS annual pay in Bulgarian hospitals is ≈ €14,400 (≈ €1,200/month,
// НСИ/МЗ 2025); a fully-equipped emergency ambulance costs ≈ €100,000 (МЗ / ЕС
// tenders). Both are round, defensible orders of magnitude — the tile labels the
// result "≈" so it reads as scale, not a precise conversion.
export const NURSE_ANNUAL_SALARY_EUR = 14_400;
export const AMBULANCE_COST_EUR = 100_000;

/** Translate a € amount into recognisable public-health units (floored counts). */
export const civicEquivalents = (
  eur: number,
): { nurseSalaries: number; ambulances: number } => ({
  nurseSalaries: Math.floor(eur / NURSE_ANNUAL_SALARY_EUR),
  ambulances: Math.floor(eur / AMBULANCE_COST_EUR),
});

export type NzokCategory =
  | "it"
  | "medical"
  | "comms"
  | "energy"
  | "services"
  | "other";

// CPV division (first two digits) → НЗОК functional category. Divisions not
// listed fall through to "other". Ordered by how НЗОК actually spends: the
// national health-IT backbone (Информационно обслужване), the medical goods it
// still buys directly (vaccines historically, consumables), communications,
// energy/fuel, and the services/security long tail (guarding, maintenance).
const CPV_TO_CATEGORY: Record<string, NzokCategory> = {
  // ИТ и системи — software, licences, computing & network hardware, integration
  "72": "it",
  "48": "it",
  "30": "it",
  "32": "it",
  "31": "it",
  // Медицински дейности и стоки — vaccines, drugs, medical devices, health svcs
  "33": "medical",
  "85": "medical",
  // Съобщения — postal + telecom
  "64": "comms",
  // Енергия и горива — electricity, fuel, petroleum products
  "09": "energy",
  // Услуги и охрана — business/admin services, security guarding, maintenance,
  // cleaning, engineering (the physical-security contracts live in division 79)
  "79": "services",
  "50": "services",
  "71": "services",
  "90": "services",
  "98": "services",
  "80": "services",
  "66": "services",
};

export const categoryOfCpv = (cpv: string | undefined): NzokCategory => {
  const d = String(cpv ?? "").slice(0, 2);
  return CPV_TO_CATEGORY[d] ?? "other";
};

export const NZOK_CATEGORY_LABEL: Record<
  NzokCategory,
  { bg: string; en: string }
> = {
  it: { bg: "ИТ и системи", en: "IT & systems" },
  medical: {
    bg: "Медицински дейности и стоки",
    en: "Medical goods & services",
  },
  comms: { bg: "Съобщения", en: "Communications" },
  energy: { bg: "Енергия и горива", en: "Energy & fuel" },
  services: { bg: "Услуги и охрана", en: "Services & security" },
  other: { bg: "Друго", en: "Other" },
};

export const categoryLabel = (c: NzokCategory, lang: string): string =>
  lang === "bg" ? NZOK_CATEGORY_LABEL[c].bg : NZOK_CATEGORY_LABEL[c].en;

// НЗОК's structural supplier whose lack of competition is set by statute, not
// procurement choice — surfaced as a context chip so a reader doesn't mistake a
// legal mandate for a red flag. Информационно обслужване АД is the state's
// declared systems integrator (ЗЕУ, 2019); НЗОК awards its national health-IT
// work to it directly (in-house / чл. 7с ЗЕУ), outside open tender.
export const NZOK_SUPPLIER_CONTEXT: Record<
  string,
  { kind: "statutory"; bg: string; en: string }
> = {
  "831641791": {
    kind: "statutory",
    bg: "Системен интегратор на държавата по закон (ЗЕУ, 2019) — националните здравно-информационни системи се възлагат пряко, извън открита процедура",
    en: "Statutory national systems integrator (2019) — the national health-IT systems are awarded directly, outside open tender",
  },
};

// Display-trim for a supplier's registered name: drop the trailing legal-form /
// address tail after the first " - "/" – "/dash or comma/slash so the tile shows
// the recognisable brand ("МБАЛ Пловдив", not "МБАЛ Пловдив - гр. Пловдив, ул…").
export const cleanSupplierName = (name: string): string =>
  name.split(/\s[-–—]\s|[,/]/)[0].trim();
