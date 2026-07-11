// The НЗОК hospital "measures" registry — the OpenPrescribing governance pattern:
// a curated set of named, standardized RATIO measures, each with a plain-language
// title, a "why it matters" line, an agreed polarity, and a shared formatter, so
// every measure renders identically (report-card badge + decile fan). The keys
// match the columns emitted by nzok_financials_measures_by_eik / _measure_fan
// (migration 056).
//
// CURATION RULES (mirrored from OpenPrescribing):
//   1. Every measure is a RATIO/rate, never a raw level — a decile comparison of a
//      level just ranks hospitals by size.
//   2. Polarity ('higherWorse' / 'higherBetter') is set ONLY where the reading is
//      unambiguous. Everything else is 'neutral' and reads positionally ("above /
//      around / below the national median") with no good/bad claim, because
//      case-mix legitimately drives cost-per-patient, ALOS, personnel share, etc.

import { formatEur } from "@/lib/currency";

export type MeasurePolarity = "higherWorse" | "higherBetter" | "neutral";
type MeasureUnit = "pct" | "eur" | "days" | "count" | "ratio";

export interface NzokMeasureDef {
  key: string;
  titleBg: string;
  titleEn: string;
  whyBg: string;
  whyEn: string;
  unit: MeasureUnit;
  polarity: MeasurePolarity;
}

// Order here is the display order in the report card.
export const NZOK_MEASURES: NzokMeasureDef[] = [
  {
    key: "overdueRevShare",
    titleBg: "Просрочени задължения (% от приходите)",
    titleEn: "Overdue liabilities (% of revenue)",
    whyBg:
      "Просрочените задължения спрямо приходите показват натиск върху ликвидността — колкото по-високи, толкова по-затруднена е болницата.",
    whyEn:
      "Overdue liabilities against revenue show liquidity strain — the higher, the more financially stressed the hospital.",
    unit: "pct",
    polarity: "higherWorse",
  },
  {
    key: "bedOccupancy",
    titleBg: "Използваемост на леглата",
    titleEn: "Bed occupancy",
    whyBg:
      "Делът на заетите легла — по-високата използваемост обикновено означава по-ефективно натоварване на капацитета.",
    whyEn:
      "Share of beds occupied — higher occupancy usually means the capacity is used more efficiently.",
    unit: "pct",
    polarity: "higherBetter",
  },
  {
    key: "alos",
    titleBg: "Среден престой",
    titleEn: "Average length of stay",
    whyBg:
      "Средният болничен престой в дни. По-краткият престой може да е ефективност или ранно изписване — зависи от профила на болницата.",
    whyEn:
      "Average hospital stay in days. A shorter stay can be efficiency or early discharge — it depends on the hospital's case-mix.",
    unit: "days",
    polarity: "neutral",
  },
  {
    key: "costPerBedDay",
    titleBg: "Разход за леглоден",
    titleEn: "Cost per bed-day",
    whyBg:
      "Разходът за един болничен ден. Различията отразяват в голяма степен профила на дейността, не (не)ефективност.",
    whyEn:
      "The cost of one hospital bed-day. Differences largely reflect the case-mix, not (in)efficiency.",
    unit: "eur",
    polarity: "neutral",
  },
  {
    key: "costPerPatient",
    titleBg: "Разход на пациент",
    titleEn: "Cost per patient",
    whyBg:
      "Разходът за един лекуван пациент. Специализираните центрове са естествено по-скъпи на пациент.",
    whyEn:
      "The cost per treated patient. Specialised centres are naturally more expensive per patient.",
    unit: "eur",
    polarity: "neutral",
  },
  {
    key: "personnelShare",
    titleBg: "Дял на разходите за персонал",
    titleEn: "Personnel cost share",
    whyBg:
      "Каква част от разходите отиват за заплати. Структурен показател — няма универсално добра стойност.",
    whyEn:
      "What share of costs goes to salaries. A structural indicator — there is no single “correct” value.",
    unit: "pct",
    polarity: "neutral",
  },
  {
    key: "patientsPerDoctor",
    titleBg: "Пациенти на лекар",
    titleEn: "Patients per doctor",
    whyBg:
      "Средно лекувани пациенти на един лекар за периода — знак за натовареност, зависещ от профила.",
    whyEn:
      "Average patients treated per doctor in the period — a workload signal that depends on the case-mix.",
    unit: "count",
    polarity: "neutral",
  },
  {
    key: "costEfficiency",
    titleBg: "Коефициент на ефективност (ЕЕОФ)",
    titleEn: "Efficiency coefficient (ЕЕОФ)",
    whyBg:
      "Коефициентът на ефективност от единните електронни отчетни форми на МЗ. Показателен, но без универсална добра посока.",
    whyEn:
      "The efficiency coefficient from the МЗ standardized reporting forms. Informative, but with no universal “good” direction.",
    unit: "ratio",
    polarity: "neutral",
  },
];

export const nzokMeasure = (key: string): NzokMeasureDef | undefined =>
  NZOK_MEASURES.find((m) => m.key === key);

/** Format a measure value for display, honouring its unit (fractions → %). */
export const formatMeasureValue = (
  key: string,
  value: number,
  lang: string,
): string => {
  const m = nzokMeasure(key);
  switch (m?.unit) {
    case "pct":
      return `${(value * 100).toFixed(1)}%`;
    case "eur":
      return formatEur(value, lang, { decimals: 0 });
    case "days":
      return `${value.toFixed(1)}${lang === "bg" ? " дни" : " d"}`;
    case "count":
      return value.toFixed(1);
    case "ratio":
      return value.toFixed(2);
    default:
      return String(value);
  }
};

/** Where a hospital sits vs the national median, with the p40/p60 tolerance band
 *  giving the CMS-style "around the median / same as national" middle state. */
export type MeasureStanding = "above" | "around" | "below";
export const measureStanding = (
  value: number,
  p40: number,
  p60: number,
): MeasureStanding =>
  value >= p40 && value <= p60 ? "around" : value > p60 ? "above" : "below";

/** Whether a standing is good / bad / neutral, given the measure's polarity.
 *  Only the two polar measures ever colour; the rest stay neutral. */
export const standingTone = (
  polarity: MeasurePolarity,
  standing: MeasureStanding,
): "good" | "bad" | "neutral" => {
  if (polarity === "neutral" || standing === "around") return "neutral";
  const highIsGood = polarity === "higherBetter";
  const isHigh = standing === "above";
  return isHigh === highIsGood ? "good" : "bad";
};

/** The bilingual "над / около / под медианата" label for a standing — the single
 *  source of wording shared by the report-card tile and the AI scorecard tool. */
const STANDING_LABEL: Record<MeasureStanding, { bg: string; en: string }> = {
  above: { bg: "над медианата", en: "above median" },
  around: { bg: "около медианата", en: "around median" },
  below: { bg: "под медианата", en: "below median" },
};
export const standingLabel = (
  standing: MeasureStanding,
  lang: string,
): string =>
  lang === "bg" ? STANDING_LABEL[standing].bg : STANDING_LABEL[standing].en;
